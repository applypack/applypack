/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { idParam } from '../params';
import { z } from 'zod';
import { prisma } from '../../db';
import { getSettings } from '../../settings';
import { getPack, markPackSent } from '../../pack/store';
import { getResume } from '../../resume/store';
import { appliedResumeColumns, packAsShown, readAppliedResumeChoice } from '../applied-resume';
import type { MessageKey } from '../../i18n/catalog';
import { clearFlashCookie, firstIssue, flashRedirect, parseFlashCookie, refusedField } from '../flash';
import { jobHref, resolveJobTab } from '../job-tabs';
import { ApplicationsPage, type ApplicationCard } from '../pages/applications';
import { allStages, labelFor, parseStageConfig, strandedStages, UNFILED_STAGE, wordedStage } from '../stage-config';
import { appliedDateCorrection, stageChangeEvent } from '../stage-events';
import { groupEventsByJob, stageTimeLine } from '../stage-time';
import { applicationsCsv, applicationsMarkdown, type ApplicationExportRow } from '../applications-export';
import { appliedWithLabel } from '../../jobs/applied-with';
import { displayZone } from '../display-zone';
import { withLocale } from '../../i18n/locale';
import { t } from '../../i18n/t';
import { companyForPage, companyOnPage } from '../../employer';
import { dayIn, dayStart, parsePastDay } from '../../zoned-day';

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

/** The tracking rail's fields as the page names them, for a refused save (#682). */
const APPLICATION_FIELD_LABEL: Record<string, MessageKey> = {
  pipelineStage: 'job.pipelineStage',
  appliedAt: 'job.appliedOn',
  recruiterContact: 'job.recruiterContact',
  applicationNotes: 'job.notes',
};

function applicationFieldLabel(field: string): string | undefined {
  const key = APPLICATION_FIELD_LABEL[field];
  return key ? t(key) : undefined;
}

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
      company: { select: { name: true, atsType: true } },
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
  // The ledger holds a day; a card counts from the moment that day began where the dashboard reads dates (#680).
  const zone = displayZone();
  const eventsByJob = groupEventsByJob(events.map((e) => ({ ...e, occurredOn: dayStart(e.occurredOn, zone) })), boardIds);
  const now = new Date();
  // A stage key no column covers any more files under "Unfiled", as the board draws it.
  const cards = rows.flatMap((j) => {
    if (!j.pipelineStage) return [];
    const stage = columns.some((col) => col.key === j.pipelineStage) ? j.pipelineStage : UNFILED_STAGE.key;
    const def = columns.find((col) => col.key === stage);
    const line = stageTimeLine(stage, j.appliedAt, eventsByJob.get(j.id) ?? [], now, labelFor(work, stage), def !== undefined && wordedStage(def));
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
      companyName: companyForPage(j.employer, j.company),
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
    200,
    { 'Set-Cookie': clearFlashCookie() },
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
      // Who hires and where the row came from, apart: a source's name in the Company column filtered as an employer (#444).
      company: companyOnPage(j.employer, j.company).name ?? '',
      source: companyOnPage(j.employer, j.company).via ?? '',
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
  // A stage of ours words its label when read: read it here, while the language is English.
  return { rows, columns: columns.map(({ key, label }) => ({ key, label })), now };
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
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  const settings = await getSettings();
  if (!settings.applicationTrackingEnabled) {
    return c.redirect('/applications', 303);
  }

  const form = await c.req.parseBody();
  const parsed = StageMoveSchema.safeParse({ toStage: form.toStage });
  if (!parsed.success) return c.text(t('http.invalidStage'), 400);
  const { toStage } = parsed.data;
  const work = parseStageConfig(settings.pipelineStages);
  if (!allStages(work).some((s) => s.key === toStage)) {
    return c.text(t('http.unknownStage'), 400);
  }

  const current = await prisma.job.findUnique({
    where: { id },
    select: { pipelineStage: true, appliedAt: true },
  });
  if (!current) return c.text(t('http.notFound'), 404);

  const event = stageChangeEvent(
    id,
    current.pipelineStage,
    toStage,
    current.appliedAt,
    new Date(),
    displayZone(),
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
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
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
  // Back to the tab the rail was used on; read through the resolver, so only a known tab reaches the redirect.
  const back = jobHref(id, resolveJobTab({ tab: typeof form.tab === 'string' ? form.tab : null }));
  if (!parsed.success) {
    // #682: the field named and marked on the job page, never a bare 400 page.
    const { issues } = parsed.error;
    return flashRedirect(back, 'err', t('jobRoute.application.notSaved', { issue: firstIssue(issues, applicationFieldLabel) }), refusedField(c.req.path, issues));
  }
  const { pipelineStage, appliedAt, recruiterContact, applicationNotes } =
    parsed.data;

  // "Which resume did I send?" is part of the application, so the form that
  // records the application records it too (#75). Until now only "Mark
  // applied" ever wrote these columns, and this form silently left them NULL.
  const current = await prisma.job.findUnique({
    where: { id },
    select: { pipelineStage: true, appliedAt: true, appliedResumeId: true },
  });
  if (!current) return c.text(t('http.notFound'), 404);

  const choice = readAppliedResumeChoice(parsed.data.appliedResumeId);
  // "The application pack's file" (ADR 0063): its text is what went out, and the pack is frozen once this is written.
  const sentPack = choice.kind === 'pack' ? packAsShown(await getPack(id), choice.at) : null;
  if (choice.kind === 'pack' && !sentPack) return flashRedirect(jobHref(id, 'pack'), 'err', t('pack.flash.changed'));
  // The resume already recorded, sent back by a form that changed something else, is not recorded again:
  // the text kept is the one that went out, and the resume may have a newer version by now.
  const unchanged = choice.kind === 'keep' || (choice.kind === 'set' && choice.id === current.appliedResumeId);
  const picked = sentPack ? await getResume(sentPack.resumeId) : choice.kind === 'set' && !unchanged ? await getResume(choice.id) : null;
  const appliedResume = unchanged ? null : appliedResumeColumns(picked && sentPack ? { ...picked, text: sentPack.text } : picked);

  const stageValue =
    pipelineStage && pipelineStage.length > 0 ? pipelineStage : null;
  // The field holds a day in the dashboard's zone (#680): the same day sent back keeps the moment on
  // record, another one is that day's start there — never the UTC midnight `new Date("2026-10-29")` reads.
  // A value that is not a day from 1990 to today keeps the date on record, and the rest is saved (#682).
  const zone = displayZone();
  const typedDay = appliedAt?.trim() ?? '';
  const appliedDay = typedDay === '' ? null : parsePastDay(typedDay, new Date(), zone);
  const dayRefused = typedDay !== '' && appliedDay === null;
  const appliedAtValue = dayRefused
    ? current.appliedAt
    : appliedDay === null
      ? null
      : current.appliedAt && dayIn(current.appliedAt, zone) === appliedDay
        ? current.appliedAt
        : dayStart(appliedDay, zone);

  // Keeping the job's current stage is always allowed — even one whose
  // column was removed by hand — but a CHANGE must land on a configured key.
  if (
    stageValue !== null &&
    stageValue !== current.pipelineStage &&
    !allStages(parseStageConfig(settings.pipelineStages)).some((s) => s.key === stageValue)
  ) {
    return c.text(t('http.unknownStage'), 400);
  }

  // F5 (ADR 0024): ledger row in the same transaction as the stage write.
  // A stage change wins; otherwise an appliedAt edit corrects the apply day.
  const event =
    stageChangeEvent(id, current.pipelineStage, stageValue, appliedAtValue, new Date(), zone) ??
    appliedDateCorrection(id, stageValue, current.appliedAt, appliedAtValue, zone);

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
  if (sentPack) await markPackSent(id, new Date());

  if (dayRefused) {
    return flashRedirect(back, 'warn', t('jobRoute.application.dayKept', { typed: typedDay.slice(0, 40) }), { field: { form: c.req.path, name: 'appliedAt' } });
  }
  return c.redirect(back, 303);
});
