/** @jsxImportSource hono/jsx */
import { AtsType, JobStatus, type Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { prisma } from '../../db';
import {
  MappingSchema,
  columnsOf,
  detectMapping,
  findJobRows,
  mapRows,
  mappingFits,
  readSourceConfig,
  sameMapping,
  usableMapping,
  FOLDER_ALERTS,
  MAPPING_FIELDS,
  type FolderAlerts,
  type Mapping,
  type SourceConfig,
} from '../../datasets/map';
import { decodeText } from '../../datasets/decode';
import { defaultImportAlerts, importBlock, packsUpTo, passingRows, previewCounts } from '../../datasets/preview';
import { readingOf } from '../../datasets/read-notes';
import { MAX_BODY_MB } from '../../datasets/rows';
import { recordCronRun, type CronStats } from '../../jobs/cron-run';
import { runImportJob } from '../../jobs/import-job';
import { employerGate, hiringKey } from '../../employer';
import { knownIds } from '../../jobs/dismissed-store';
import { loadEmployerRules } from '../../jobs/employer-store';
import { isBlankProfile } from '../../profile-guards';
import { listActiveProfiles } from '../../profiles';
import { getPackSettings, getSettings } from '../../settings';
import { alertChannel } from '../../notifier';
import { autoPacksToday } from '../../pack/store';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { spendHint } from '../cost-hint';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { dropImport, getImport, keepImport, stashImport, type ImportStash } from '../import-stash';
import { importBlockText, summarizeImport } from '../import-summary';
import { logger } from '../../logger';
import { JobImportPage, JobImportPreviewPage, type ImportSourceRow } from '../pages/job-import';
import { idParam } from '../params';
import { claimRun, findLiveRun, startRun, updateRun } from '../target-runs';

/*
 * /jobs/import — a file of jobs the user brings (ADR 0062). Upload → a
 * preview that spends no AI (the mapping, three rows, the counts, the cost)
 * → the import, which is `processNormalizedJobs` under the fetch lock, on a
 * progress page, with a row on /runs. No request leaves the machine, and the
 * file itself is never written anywhere: its rows wait in memory between the
 * two steps (import-stash.ts).
 */

const MAX_IMPORT_BYTES = MAX_BODY_MB * 1024 * 1024;
const tooLarge = (): string => t('import.tooLarge', { mb: MAX_BODY_MB });
/** The file plus what a multipart body wraps around it and the two small fields. */
const BODY_SLACK_BYTES = 64 * 1024;
const MAX_SOURCE_NAME_CHARS = 80;
const MAX_FILE_NAME_CHARS = 120;
/** An import scoring a few hundred rows on a CLI engine outlasts the half hour a run is usually kept. */
const IMPORT_RUN_KEEP_MS = 6 * 60 * 60_000;
const GONE = 'import.gone' satisfies MessageKey;
/** The pipeline threw: what is safe (stored rows stay) and the way forward. */
const IMPORT_FAILED = 'import.failed' satisfies MessageKey;

export const jobsImportRoute = new Hono();

/** "September export" → "september-export": the import source's atsToken, so the same name is the same source. */
function sourceSlug(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SOURCE_NAME_CHARS) || 'import';
}

/** The import sources with what a delete would take: a job cascades to its application, its comparisons and its letters. */
async function importSources(): Promise<ImportSourceRow[]> {
  const sources = await prisma.company.findMany({
    where: { atsType: AtsType.IMPORT },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { jobs: true } }, jobs: { select: { fetchedAt: true }, orderBy: { fetchedAt: 'desc' }, take: 1 } },
  });
  return Promise.all(
    sources.map(async (s) => {
      const [applications, comparisons, letters] = await Promise.all([
        prisma.job.count({ where: { companyId: s.id, OR: [{ pipelineStage: { not: null } }, { status: JobStatus.APPLIED }] } }),
        prisma.resumeMatch.count({ where: { job: { companyId: s.id } } }),
        prisma.coverLetter.count({ where: { job: { companyId: s.id } } }),
      ]);
      return { id: s.id, name: s.name, lastImportAt: s.jobs[0]?.fetchedAt ?? null, impact: { jobs: s._count.jobs, applications, comparisons, letters } };
    }),
  );
}

jobsImportRoute.get('/jobs/import', async (c) =>
  c.html(<JobImportPage sources={await importSources()} flash={parseFlashCookie(c.req.header('cookie'))} />, 200, {
    'Set-Cookie': clearFlashCookie(),
  }),
);

jobsImportRoute.post(
  '/jobs/import',
  bodyLimit({
    maxSize: MAX_IMPORT_BYTES + BODY_SLACK_BYTES,
    onError: () => flashRedirect('/jobs/import', 'err', tooLarge()),
  }),
  async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    // No file chosen arrives as a nameless empty one; a named one with nothing in it was chosen, and is told so.
    if (!(file instanceof File) || (file.size === 0 && file.name === '')) return flashRedirect('/jobs/import', 'err', t('import.chooseFile'));
    if (file.size === 0) return flashRedirect('/jobs/import', 'err', t('import.emptyFile', { file: file.name.slice(0, MAX_FILE_NAME_CHARS) }));
    if (file.size > MAX_IMPORT_BYTES) return flashRedirect('/jobs/import', 'err', tooLarge());

    // An existing source by its id, else a name: the same name is the same source.
    const existingId = idParam(form.source);
    const typed = typeof form.sourceName === 'string' ? form.sourceName.replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE_NAME_CHARS) : '';
    const existing = Number.isFinite(existingId)
      ? await prisma.company.findFirst({ where: { id: existingId, atsType: AtsType.IMPORT }, select: { id: true, name: true, sourceConfig: true } })
      : typed.length > 0
        ? await prisma.company.findUnique({ where: { atsType_atsToken: { atsType: AtsType.IMPORT, atsToken: sourceSlug(typed) } }, select: { id: true, name: true, sourceConfig: true } })
        : null;
    if (!existing && typed.length === 0) return flashRedirect('/jobs/import', 'err', t('import.nameSource'));

    // A file name is the sender's text: cut before it rides in a flash cookie or is shown.
    const fileName = file.name.slice(0, MAX_FILE_NAME_CHARS);
    const decoded = decodeText(new Uint8Array(await file.arrayBuffer()));
    const found = findJobRows(decoded.text);
    if (!found.ok) return flashRedirect('/jobs/import', 'err', `${fileName}: ${found.error}`);

    // The mapping the source was last imported with, when this file still has those columns.
    const kept = existing ? readSourceConfig(existing.sourceConfig)?.mapping : undefined;
    const detected = kept && mappingFits(kept, columnsOf(found.rows)) ? { mapping: kept, guessed: [] } : detectMapping(found.rows);
    const stash = stashImport({
      format: found.format,
      rows: found.rows,
      over: found.over,
      notRows: found.notRows,
      reading: readingOf(decoded, found.cutAt),
      ...detected,
      fileName,
      source: existing ? { id: existing.id, name: existing.name } : { id: null, name: typed },
      alerts: null,
    });
    return c.redirect(`/jobs/import/${stash.id}`, 303);
  },
);

/** The form's Alerts choice; null when the page drew none (nothing would be scored) or the value is not one it offers. */
function alertsFromForm(form: Record<string, unknown>): FolderAlerts | null {
  return FOLDER_ALERTS.find((a) => a === form.alerts) ?? null;
}

/** The form's selects as a mapping, or null when one names a column the file does not offer. */
function mappingFromForm(form: Record<string, unknown>, stash: ImportStash): Mapping | null {
  const parsed = MappingSchema.safeParse(form);
  if (!parsed.success) return null;
  const columns = columnsOf(stash.rows);
  return MAPPING_FIELDS.every((f) => parsed.data[f] === null || columns.includes(parsed.data[f])) ? parsed.data : null;
}

/**
 * What an import of the stashed rows would do, as things stand now: the rows
 * as jobs, how many are new and wanted, and whether anything is scored. The
 * preview shows it, and the import asks it again before it writes anything.
 */
async function previewFacts(stash: ImportStash) {
  const now = new Date();
  const mapped = mapRows(stash.rows, stash.mapping, stash.source.id ?? 0, now);
  const [settings, active, employers, storedIds] = await Promise.all([
    getSettings(),
    listActiveProfiles(),
    loadEmployerRules(now),
    // What the source holds, a dismissal the cleanup deleted included: the import counts those as duplicates (#474).
    stash.source.id === null ? new Set<string>() : knownIds(stash.source.id, mapped.jobs.map((j) => j.externalId)),
  ]);
  // The roster the import itself will ask (process-jobs.ts): blank searches judge nothing once scoring is on.
  const scoring = settings.fetchingEnabled;
  const roster = scoring ? active.filter((p) => !isBlankProfile(p)) : active;
  // The employer gate as the tick applies it: these rows always name their own employer, or nobody (ADR 0056).
  const turnsAway = (job: (typeof mapped.jobs)[number]): boolean => employerGate(hiringKey(job.employer, stash.source.name, true), employers) !== null;
  const counts = previewCounts(mapped.jobs, roster, storedIds, turnsAway);
  // What the Alerts choice is about, read only when there is something to choose: who would hear, and how many packs.
  const choosing = scoring && counts.passing > 0;
  const [channel, packSettings, queuedToday] = choosing ? await Promise.all([alertChannel(), getPackSettings(), autoPacksToday(now)]) : [null, null, 0];
  const sends = choosing && channel && packSettings
    ? {
        alerts: stash.alerts ?? defaultImportAlerts(counts.passing),
        chosen: stash.alerts !== null,
        channel,
        packs: packsUpTo(passingRows(mapped.jobs, roster, storedIds, turnsAway), packSettings, queuedToday, now),
        packFit: packSettings.minFit,
      }
    : null;
  return { mapped, counts, scoring, searches: { running: active.length, usable: roster.length }, sends };
}

jobsImportRoute.get('/jobs/import/:token', async (c) => {
  const stash = getImport(c.req.param('token'));
  if (!stash) return flashRedirect('/jobs/import', 'err', t(GONE));
  const { mapped, counts, scoring, searches, sends } = await previewFacts(stash);
  return c.html(
    <JobImportPreviewPage
      stash={stash}
      columns={columnsOf(stash.rows)}
      mapped={mapped}
      counts={counts}
      scoring={scoring}
      searches={searches}
      sends={sends}
      cost={scoring && counts.passing > 0 ? await spendHint('classifier') : ''}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

/** "Update the preview": the selects as the user set them, kept with the rows. */
jobsImportRoute.post('/jobs/import/:token/mapping', async (c) => {
  const stash = getImport(c.req.param('token'));
  if (!stash) return flashRedirect('/jobs/import', 'err', t(GONE));
  const body = await c.req.parseBody();
  const mapping = mappingFromForm(body, stash);
  if (!mapping) return flashRedirect(`/jobs/import/${stash.id}`, 'err', t('import.columnNotInFile'));
  keepMapping(stash, mapping);
  stash.alerts = alertsFromForm(body) ?? stash.alerts;
  return c.redirect(`/jobs/import/${stash.id}`, 303);
});

/** The selects as the person set them, kept with the rows; a field they changed is no longer a guess. */
function keepMapping(stash: ImportStash, mapping: Mapping): void {
  stash.guessed = stash.guessed.filter((f) => mapping[f] === stash.mapping[f]);
  stash.mapping = mapping;
}

jobsImportRoute.post('/jobs/import/:token', async (c) => {
  const token = c.req.param('token');
  const key = `import:${token}`;
  // A second press while the first is still storing joins it.
  const live = findLiveRun(key);
  if (live) return c.redirect(`/target/runs/${live.id}`, 303);
  const stash = getImport(token);
  if (!stash) return flashRedirect('/jobs/import', 'err', t(GONE));
  const back = `/jobs/import/${stash.id}`;
  const body = await c.req.parseBody();
  const mapping = mappingFromForm(body, stash);
  // The choice as the page showed it when pressed: kept with the rows, so a preview drawn again still shows it.
  stash.alerts = alertsFromForm(body) ?? stash.alerts;
  if (!mapping || !usableMapping(mapping)) {
    return flashRedirect(back, 'err', t('import.flash.noTitle'));
  }
  // Selects changed since the preview was drawn were never shown as rows, and nothing is stored before the
  // person has seen three rows as they would be kept (ADR 0062): keep them and show that preview first (#404).
  if (!sameMapping(mapping, stash.mapping)) {
    keepMapping(stash, mapping);
    return flashRedirect(back, 'warn', t('import.flash.mappingChanged'));
  }
  // Before a source row is written: what the preview refuses, the import refuses, for the same reason —
  // a form posted anyway (an old tab, a double press) leaves nothing behind (#364).
  const { mapped, counts, scoring, searches } = await previewFacts(stash);
  const block = importBlock({ mappingUsable: true, jobs: mapped.jobs.length, searches, scoring, passing: counts.passing });
  if (block) return flashRedirect(back, 'err', importBlockText(block));

  // No choice came with the press (a form posted by something other than the page): what the size is offered with.
  const alerts = stash.alerts ?? defaultImportAlerts(counts.passing);
  const config: SourceConfig = { holds: 'rows', mapping, include: null, alerts };
  const sourceConfig = config as Prisma.InputJsonValue;
  let source: { id: number; name: string };
  // A source this press makes is taken back if the run stores nothing in it (a fetch was running, a search switched off meanwhile).
  const created = stash.source.id === null;
  if (stash.source.id !== null) {
    const kept = await prisma.company.updateMany({ where: { id: stash.source.id, atsType: AtsType.IMPORT }, data: { sourceConfig } });
    if (kept.count === 0) return flashRedirect('/jobs/import', 'err', t('import.flash.sourceGone'));
    source = { id: stash.source.id, name: stash.source.name };
  } else {
    const atsToken = sourceSlug(stash.source.name);
    source = await prisma.company.upsert({
      where: { atsType_atsToken: { atsType: AtsType.IMPORT, atsToken } },
      update: { sourceConfig },
      create: { name: stash.source.name, atsType: AtsType.IMPORT, atsToken, active: false, sourceConfig },
      select: { id: true, name: true },
    });
    stash.source = source;
  }

  const jobs = mapped.jobs.map((job) => ({ ...job, companyId: source.id }));

  const { fetchingEnabled } = await getSettings();
  const { run, joined } = claimRun(key, {
    steps: ['import'],
    jobTitle: stash.fileName,
    resumeName: source.name,
    heading: { running: t('import.run.running'), failed: t('import.run.failed') },
    subtitle: t('import.run.subtitle', { n: jobs.length, file: stash.fileName, source: source.name, paused: fetchingEnabled ? 'no' : 'yes' }),
    backUrl: back,
    backLabel: t('import.run.back'),
    keepMs: IMPORT_RUN_KEEP_MS,
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);

  startRun(run.id, async () => {
    let stats: CronStats = {};
    try {
      await recordCronRun('import', async () => {
        const out = await runImportJob(source, jobs, alerts);
        stats = out.stats;
        return out;
      });
    } catch (err) {
      logger.error({ err, runId: run.id }, 'web: import run failed');
      keepImport(stash);
      return updateRun(run.id, { stage: 'error', error: t(IMPORT_FAILED) });
    }
    if (created && (await dropEmptySource(source.id))) stash.source = { id: null, name: source.name };
    const { kind, text } = summarizeImport(stats, stash.fileName, source.name);
    // Stored: the rows have done their job. Anything else sends the person back to this preview for another
    // press, so the rows wait a fresh half hour: the import may have outlasted the one its upload had (#404).
    if (kind === 'ok') dropImport(stash.id);
    else keepImport(stash);
    if (kind === 'err') return updateRun(run.id, { stage: 'error', error: text });
    updateRun(run.id, { stage: 'done', resultUrl: kind === 'ok' ? '/jobs' : back, flash: text, flashKind: kind });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/** An import source that holds no job is no source: removed, and true when it was. One that holds a job is never touched. */
async function dropEmptySource(id: number): Promise<boolean> {
  const { count } = await prisma.company.deleteMany({ where: { id, atsType: AtsType.IMPORT, jobs: { none: {} } } });
  return count > 0;
}

/** One press removes a source and every job it brought — the cascade every source has. */
jobsImportRoute.post('/jobs/import/sources/:id/delete', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  const source = await prisma.company.findFirst({ where: { id, atsType: AtsType.IMPORT }, select: { name: true } });
  if (!source) return c.text(t('http.notFound'), 404);
  await prisma.company.delete({ where: { id } });
  return flashRedirect('/jobs/import', 'ok', t('import.flash.deleted', { name: source.name }));
});
