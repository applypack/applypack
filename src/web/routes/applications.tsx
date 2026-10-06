/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { idParam } from '../params';
import { z } from 'zod';
import { prisma } from '../../db';
import { getSettings } from '../../settings';
import { getResume } from '../../resume/store';
import { appliedResumeColumns, readAppliedResumeChoice } from '../applied-resume';
import { flashRedirect, parseFlashCookie } from '../flash';
import { jobHref, resolveJobTab } from '../job-tabs';
import { ApplicationsPage, type ApplicationCard } from '../pages/applications';
import { allStages, labelFor, parseStageConfig, strandedStages, UNFILED_STAGE } from '../stage-config';
import { appliedDateCorrection, stageChangeEvent } from '../stage-events';
import { groupEventsByJob, stageTimeLine, type StageTimeLine } from '../stage-time';
import { applicationsCsv, applicationsMarkdown, dayIn, type ApplicationExportRow } from '../applications-export';
import { appliedWithLabel } from '../../jobs/applied-with';
import { displayZone } from '../display-zone';
import { withLocale } from '../../i18n/locale';
import { t } from '../../i18n/t';

// Stage keys are validated at runtime against the configured list
// (ADR 0025) — an enum would freeze what is now user data.
const ApplicationFormSchema = z.object({
  pipelineStage: z.string().max(40).optional(),
  appliedAt: z.string().optional(),
  recruiterContact: z.string().max(300).optional(),
  applicationNotes: z.string().max(10_000).optional(),
  // Absent when the page had no resumes to offer — "keep what is stored"
  // rather than "erase it" (applied-resume.ts).
  appliedResumeId: z.string().optional(),
});

export const applicationsRoute = new Hono();

/**
 * Every job that holds a stage, not only the ones a column covers: a column
 * the user removed used to strand its jobs, invisible and with nothing to
 * drag them out of. They land in "Unfiled" instead. The page and the two
 * exports read the board from here.
 */
async function loadBoard() {
  const settings = await getSettings();
  const work = parseStageConfig(settings.pipelineStages);
  const rows = await prisma.job.findMany({
    where: { pipelineStage: { not: null } },
    select: {
      id: true,
      title: true,
      url: true,
      employer: true,
      fitScore: true,
      recruiterContact: true,
      applicationNotes: true,
      pipelineStage: true,
      appliedAt: true,
      appliedResumeVersion: true,
      appliedResume: { select: { name: true } },
      company: { select: { name: true } },
    },
    orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
  });

  // The ledger dates each card's time-in-stage (ADR 0024 keeps recording
  // even though the funnel cards are gone — ADR 0025). Scoped to the cards
  // on screen: the ledger is append-only, so it grows with every stage move
  // ever made while the board only dates the jobs it draws.
  const boardIds = rows.map((r) => r.id);
  const events =
    settings.applicationTrackingEnabled && boardIds.length > 0
      ? await prisma.jobStageEvent.findMany({
          where: { jobId: { in: boardIds } },
          orderBy: { recordedAt: 'asc' },
        })
      : [];
  const stranded = strandedStages(work, rows.map((r) => r.pipelineStage));
  const columns = [...allStages(work), ...(stranded.length > 0 ? [UNFILED_STAGE] : [])];
  const eventsByJob = groupEventsByJob(events, boardIds);
  const now = new Date();
  // A stage key no column covers any more files under "Unfiled", as the board draws it.
  const cards = rows.flatMap((j) => {
    if (!j.pipelineStage) return [];
    const stage = columns.some((col) => col.key === j.pipelineStage) ? j.pipelineStage : UNFILED_STAGE.key;
    const line = stageTimeLine(stage, j.appliedAt, eventsByJob.get(j.id) ?? [], now, labelFor(work, stage));
    return [{ job: j, stage, line }];
  });
  return { settings, work, columns, stranded: stranded.length > 0, cards, now };
}

applicationsRoute.get('/applications', async (c) => {
  const { settings, work, columns, stranded, cards } = await loadBoard();
  const byStage: Record<string, ApplicationCard[]> = Object.fromEntries(columns.map((s) => [s.key, []]));
  for (const { job: j, stage, line } of cards) {
    byStage[stage]!.push({
      id: j.id,
      title: j.title,
      companyName: j.employer ?? j.company.name,
      fitScore: j.fitScore,
      recruiterContact: j.recruiterContact,
      stageLine: line,
    });
  }

  return c.html(
    <ApplicationsPage
      byStage={byStage}
      work={work}
      stranded={stranded}
      applicationTrackingEnabled={settings.applicationTrackingEnabled}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
  );
});

/**
 * The board as rows for a file, in column order, newest application first
 * within a column. A file is data, as its header is: the stages the interface
 * names itself are written in English whatever language the page reads in.
 */
function exportRows(): Promise<{ rows: ApplicationExportRow[]; columns: { key: string; label: string }[]; now: Date }> {
  return withLocale('en', boardRows);
}

async function boardRows(): Promise<{ rows: ApplicationExportRow[]; columns: { key: string; label: string }[]; now: Date }> {
  const { work, columns, cards, now } = await loadBoard();
  const order = new Map(columns.map((col, i) => [col.key, i]));
  const rows = cards
    .map(({ job: j, stage, line }) => ({
      stageKey: stage,
      stage: stage === UNFILED_STAGE.key ? UNFILED_STAGE.label : labelFor(work, stage),
      company: j.employer ?? j.company.name,
      title: j.title,
      appliedAt: j.appliedAt,
      stageSince: line?.since ?? null,
      fitScore: j.fitScore,
      resume: appliedWithLabel(
        j.appliedResumeVersion === null && j.appliedResume === null
          ? null
          : { name: j.appliedResume?.name ?? null, version: j.appliedResumeVersion },
      ),
      recruiterContact: j.recruiterContact,
      notes: j.applicationNotes,
      url: j.url,
    }))
    .sort((a, b) => (order.get(a.stageKey) ?? 0) - (order.get(b.stageKey) ?? 0));
  return { rows, columns, now };
}

/** TASKS N7: the board as a file — CSV for a spreadsheet, Markdown to read. Dates are days in the dashboard's time zone. */
applicationsRoute.get('/applications/export.csv', async (c) => {
  const { rows, now } = await exportRows();
  return c.body(applicationsCsv(rows, displayZone()), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="applications-${dayIn(now, displayZone())}.csv"`,
  });
});

applicationsRoute.get('/applications/export.md', async (c) => {
  const { rows, columns, now } = await exportRows();
  return c.body(applicationsMarkdown(rows, columns, displayZone(), now), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="applications-${dayIn(now, displayZone())}.md"`,
  });
});

const StageMoveSchema = z.object({ toStage: z.string().min(1).max(40) });

// Board quick-move: writes pipelineStage and its ledger row, nothing else.
// The full form on /jobs/:id stays the only place that edits appliedAt /
// recruiterContact / applicationNotes — reusing it here would null them out.
applicationsRoute.post('/jobs/:id/stage', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const settings = await getSettings();
  if (!settings.applicationTrackingEnabled) {
    return c.redirect('/applications', 303);
  }

  const form = await c.req.parseBody();
  const parsed = StageMoveSchema.safeParse({ toStage: form.toStage });
  if (!parsed.success) return c.text('Invalid stage', 400);
  const { toStage } = parsed.data;
  const work = parseStageConfig(settings.pipelineStages);
  if (!allStages(work).some((s) => s.key === toStage)) {
    return c.text('Unknown stage', 400);
  }

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
  return flashRedirect('/applications', 'ok', t('applications.movedTo', { stage: labelFor(work, toStage) }));
});

applicationsRoute.post('/jobs/:id/application', async (c) => {
  const id = idParam(c.req.param('id'));
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
    appliedResumeId: form.appliedResumeId,
  });
  if (!parsed.success) {
    return c.text('Invalid form values', 400);
  }
  const { pipelineStage, appliedAt, recruiterContact, applicationNotes } =
    parsed.data;

  // "Which resume did I send?" is part of the application, so the form that
  // records the application records it too (#75). Until now only "Mark
  // applied" ever wrote these columns, and this form silently left them NULL.
  const choice = readAppliedResumeChoice(parsed.data.appliedResumeId);
  const appliedResume =
    choice.kind === 'keep'
      ? null
      : appliedResumeColumns(choice.kind === 'set' ? await getResume(choice.id) : null);

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

  // Keeping the job's current stage is always allowed — even one whose
  // column was removed by hand — but a CHANGE must land on a configured key.
  if (
    stageValue !== null &&
    stageValue !== current.pipelineStage &&
    !allStages(parseStageConfig(settings.pipelineStages)).some((s) => s.key === stageValue)
  ) {
    return c.text('Unknown stage', 400);
  }

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
      ...(appliedResume ?? {}),
    },
  });
  if (event) {
    await prisma.$transaction([update, prisma.jobStageEvent.create({ data: event })]);
  } else {
    await update;
  }

  // Back to the tab the rail was used on; read through the resolver, so only a known tab reaches the redirect.
  return c.redirect(jobHref(id, resolveJobTab({ tab: typeof form.tab === 'string' ? form.tab : null })), 303);
});
