/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../../db';
import { getSettings } from '../../settings';
import { ApplicationsPage } from '../pages/applications';
import { appliedDateCorrection, stageChangeEvent } from '../stage-events';
import { calibration, funnel, groupByJob, velocity } from '../stats';

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
      appliedAt: Date | null;
      recruiterContact: string | null;
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
      appliedAt: j.appliedAt,
      recruiterContact: j.recruiterContact,
    });
  }

  return c.html(
    <ApplicationsPage
      byStage={byStage}
      applicationTrackingEnabled={settings.applicationTrackingEnabled}
      stats={settings.applicationTrackingEnabled ? await loadFunnelStats() : null}
    />,
  );
});

// F5 (ADR 0024): fold the ledger into funnel / velocity / calibration.
async function loadFunnelStats() {
  const events = await prisma.jobStageEvent.findMany({
    orderBy: { recordedAt: 'asc' },
  });
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
