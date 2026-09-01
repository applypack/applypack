/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../../db';
import { getSettings } from '../../settings';
import { flashRedirect, parseFlashCookie } from '../flash';
import { ApplicationsPage, STAGE_LABEL } from '../pages/applications';
import { appliedDateCorrection, stageChangeEvent } from '../stage-events';
import { stageTimeLine, type StageTimeLine } from '../stage-time';
import { calibration, funnel, groupByJob, velocity, type StageEventRow } from '../stats';

const STAGE_VALUES = [
  'applied',
  'screen',
  'tech',
  'onsite',
  'offer',
  'rejected',
  'ghosted',
] as const;
type Stage = (typeof STAGE_VALUES)[number];

export const ApplicationFormSchema = z.object({
  pipelineStage: z
    .union([z.enum(STAGE_VALUES), z.literal('')])
    .optional(),
  appliedAt: z.string().optional(),
  recruiterContact: z.string().optional(),
  applicationNotes: z.string().optional(),
});

export const applicationsRoute = new Hono();

applicationsRoute.get('/applications', async (c) => {
  const settings = await getSettings();

  const rows = await prisma.job.findMany({
    where: { pipelineStage: { in: [...STAGE_VALUES] } },
    include: { company: { select: { name: true } } },
    orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
  });

  // One fetch feeds both the funnel stats and the per-card time-in-stage.
  const events = settings.applicationTrackingEnabled
    ? await prisma.jobStageEvent.findMany({ orderBy: { recordedAt: 'asc' } })
    : [];
  const eventsByJob = new Map<number, typeof events>();
  for (const e of events) {
    const list = eventsByJob.get(e.jobId);
    if (list) list.push(e);
    else eventsByJob.set(e.jobId, [e]);
  }

  const now = new Date();
  const empty: Record<Stage, []> = {
    applied: [],
    screen: [],
    tech: [],
    onsite: [],
    offer: [],
    rejected: [],
    ghosted: [],
  };
  const byStage = { ...empty } as Record<
    Stage,
    Array<{
      id: number;
      title: string;
      companyName: string;
      fitScore: number | null;
      recruiterContact: string | null;
      stageLine: StageTimeLine | null;
    }>
  >;
  for (const j of rows) {
    const stage = j.pipelineStage as Stage | null;
    if (!stage || !STAGE_VALUES.includes(stage)) continue;
    byStage[stage].push({
      id: j.id,
      title: j.title,
      companyName: j.company.name,
      fitScore: j.fitScore,
      recruiterContact: j.recruiterContact,
      stageLine: stageTimeLine(stage, j.appliedAt, eventsByJob.get(j.id) ?? [], now),
    });
  }

  return c.html(
    <ApplicationsPage
      byStage={byStage}
      applicationTrackingEnabled={settings.applicationTrackingEnabled}
      stats={settings.applicationTrackingEnabled ? await loadFunnelStats(events) : null}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
  );
});

const StageMoveSchema = z.object({ toStage: z.enum(STAGE_VALUES) });

// Board quick-move: writes pipelineStage and its ledger row, nothing else.
// The full form on /jobs/:id stays the only place that edits appliedAt /
// recruiterContact / applicationNotes — reusing it here would null them out.
applicationsRoute.post('/jobs/:id/stage', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const settings = await getSettings();
  if (!settings.applicationTrackingEnabled) {
    return c.redirect('/applications', 303);
  }

  const form = await c.req.parseBody();
  const parsed = StageMoveSchema.safeParse({ toStage: form.toStage });
  if (!parsed.success) return c.text('Invalid stage', 400);
  const { toStage } = parsed.data;

  const current = await prisma.job.findUnique({
    where: { id },
    select: { pipelineStage: true, appliedAt: true },
  });
  if (!current) return c.text('Not found', 404);

  const event = stageChangeEvent(
    id,
    current.pipelineStage,
    toStage,
    current.appliedAt,
    new Date(),
  );
  if (event) {
    await prisma.$transaction([
      prisma.job.update({ where: { id }, data: { pipelineStage: toStage } }),
      prisma.jobStageEvent.create({ data: event }),
    ]);
  }
  return flashRedirect('/applications', 'ok', `Moved to ${STAGE_LABEL[toStage]}`);
});

// F5 (ADR 0024): fold the ledger into funnel / velocity / calibration.
async function loadFunnelStats(events: StageEventRow[]) {
  const eventJobIds = [...new Set(events.map((e) => e.jobId))];
  const fitRows = eventJobIds.length
    ? await prisma.job.findMany({
        where: { id: { in: eventJobIds } },
        select: { id: true, fitScore: true },
      })
    : [];
  const fitById = new Map(fitRows.map((j) => [j.id, j.fitScore]));
  const histories = groupByJob(events);
  return {
    funnel: funnel(histories.values()),
    hops: velocity(histories.values()),
    calibration: calibration(
      [...histories].map(([jobId, history]) => ({
        fitScore: fitById.get(jobId) ?? null,
        history,
      })),
    ),
  };
}

applicationsRoute.post('/jobs/:id/application', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const settings = await getSettings();
  if (!settings.applicationTrackingEnabled) {
    return c.redirect(`/jobs/${id}`, 303);
  }

  const form = await c.req.parseBody();
  const parsed = ApplicationFormSchema.safeParse({
    pipelineStage: form.pipelineStage,
    appliedAt: form.appliedAt,
    recruiterContact: form.recruiterContact,
    applicationNotes: form.applicationNotes,
  });
  if (!parsed.success) {
    return c.text('Invalid form values', 400);
  }
  const { pipelineStage, appliedAt, recruiterContact, applicationNotes } =
    parsed.data;

  const stageValue =
    pipelineStage && pipelineStage.length > 0 ? pipelineStage : null;
  const appliedAtValue =
    appliedAt && appliedAt.length > 0 && !Number.isNaN(Date.parse(appliedAt))
      ? new Date(appliedAt)
      : null;

  const current = await prisma.job.findUnique({
    where: { id },
    select: { pipelineStage: true, appliedAt: true },
  });
  if (!current) return c.text('Not found', 404);

  // F5 (ADR 0024): ledger row in the same transaction as the stage write.
  // A stage change wins; otherwise an appliedAt edit corrects the apply day.
  const event =
    stageChangeEvent(id, current.pipelineStage, stageValue, appliedAtValue, new Date()) ??
    appliedDateCorrection(id, stageValue, current.appliedAt, appliedAtValue);

  const update = prisma.job.update({
    where: { id },
    data: {
      pipelineStage: stageValue,
      appliedAt: appliedAtValue,
      recruiterContact:
        recruiterContact && recruiterContact.trim().length > 0
          ? recruiterContact.trim()
          : null,
      applicationNotes:
        applicationNotes && applicationNotes.trim().length > 0
          ? applicationNotes
          : null,
    },
  });
  if (event) {
    await prisma.$transaction([update, prisma.jobStageEvent.create({ data: event })]);
  } else {
    await update;
  }

  return c.redirect(`/jobs/${id}`, 303);
});
