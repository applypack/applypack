/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { idParam } from '../params';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { isUniqueViolation, prisma } from '../../db';
import { logger } from '../../logger';
import { billingFacts, getAiRuntime } from '../../ai-runtime';
import { AI_PROVIDER_LABELS } from '../../ai-engine';
import { billingOf } from '../../ai-usage';
import { config } from '../../config';
import { getAiKeys, getSettings } from '../../settings';
import { createManualJob, MAX_FIELD_CHARS, MAX_POSTING_CHARS, MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { onceGuard } from '../once-guard';
import { briefForPosting, briefLine } from '../../resume/brief';
import { ResumeTextError } from '../../resume/docx-text';
import { extractResumeText } from '../../resume/resume-text';
import { MAX_ZIP_ENTRIES } from '../../resume/zip';
import { applyPreset, draftRubric, PRESETS, rubricEquals, rubricFromForm, rubricSummary, type Preset } from '../../screening/rubric';
import { displayName, expandUploads, fingerprintBytes, fingerprintText, coverLetterSignal, letterOwners, MAX_APPLICANTS_PER_SCREENING, MAX_BATCH_UPLOAD_MB, planIntake } from '../../screening/intake';
import { findLeaks, heldNote, leakKinds, noteWords, readRedactions, redactApplicant } from '../../screening/redact';
import { MAX_COMPARE, MIN_COMPARE, readScreenReply } from '../../screening/prompts';
import { comparisonMarkdown, comparisonView, readStoredComparison } from '../../screening/comparison';
import { compareApplicants } from '../../screening/compare';
import { loadKeywordMatcher } from '../../resume/keyword-matcher';
import { readScreenBreakdown } from '../../screening/score';
import { MAX_ADJUSTMENT, toCsv, toMarkdown } from '../../screening/export';
import { screeningRun, startScreeningRun } from '../../screening/batch';
import {
  countApplicants,
  createApplicants,
  createLetters,
  getLetterFile,
  listLetters,
  releaseApplicant,
  createScreening,
  DECISIONS,
  deleteApplicant,
  deleteApplicants,
  deleteScreening,
  extendRetention,
  getApplicant,
  getApplicantFile,
  getScreening,
  latestComparison,
  listApplicants,
  listApplicantsWithText,
  listKnownApplicants,
  listScreenings,
  postingOf,
  rubricOf,
  savePosting,
  saveRubric,
  setAdjustment,
  setDecision,
  setDecisionMany,
  type ApplicantWithVerdict,
  type Decision,
  type ScreeningWithJob,
} from '../../screening/store';
import { requireEmployerMode } from '../employer-mode';
import { clearFlashCookie, firstIssue, flashRedirect, parseFlashCookie, refusedField, safeBack } from '../flash';
import { ScreenListPage } from '../pages/screen-list';
import { ScreenNewPage } from '../pages/screen-new';
import { ScreenDetailPage } from '../pages/screen-detail';
import { ScreenApplicantPage } from '../pages/screen-applicant';
import { ScreenComparePage } from '../pages/screen-compare';
import { sideBySide } from '../screen-compare';
import { applicantStatus, calibrationRows, exportRows, rowView, scoredBeforePosting } from '../screen-view';
import { calibrate } from '../../screening/calibration';
import { toPickOption } from '../job-pick';
import { claimRun, startRun, updateRun } from '../target-runs';
import { MAX_UPLOAD_MB } from '../upload';
import { withLocale } from '../../i18n/locale';
import { t } from '../../i18n/t';

/*
 * Employer mode (TASKS §19, ADR 0049): every route here sits behind
 * requireEmployerMode, so with the switch off the section does not exist.
 * The worker never imports any of this.
 */

const JOB_PICK_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export const screenRoute = new Hono();
screenRoute.use('/screen', requireEmployerMode);
screenRoute.use('/screen/*', requireEmployerMode);

function flash(c: { req: { header(name: string): string | undefined } }) {
  return parseFlashCookie(c.req.header('cookie'));
}
const CLEAR = { 'Set-Cookie': clearFlashCookie() };

screenRoute.get('/screen', async (c) => {
  return c.html(<ScreenListPage screenings={await listScreenings()} flash={flash(c)} />, 200, CLEAR);
});

screenRoute.get('/screen/new', async (c) => {
  // Pasted postings first — a position someone is hiring for is far likelier
  // to have been pasted than fetched from a board — then the newest.
  const jobs = await prisma.job.findMany({
    where: { status: { not: 'DISMISSED' } },
    orderBy: [{ fetchedAt: 'desc' }],
    take: JOB_PICK_LIMIT,
    // A picker option, not a posting (DATA-5).
    select: { id: true, title: true, employer: true, fetchedAt: true, company: { select: { name: true, atsType: true } } },
  });
  const now = Date.now();
  const manual = (j: (typeof jobs)[number]): boolean => j.company.atsType === 'MANUAL';
  const options = jobs
    .sort((a, b) => Number(manual(b)) - Number(manual(a)))
    .map((j) => toPickOption(j, manual(j) ? 'pasted' : null, now));
  return c.html(<ScreenNewPage jobs={options} flash={flash(c)} />, 200, CLEAR);
});

const NewScreeningSchema = z.object({
  jobMode: z.enum(['existing', 'new']).default('existing'),
  jobId: z.coerce.number().int().optional(),
  title: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  companyName: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  location: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  description: z.string().default(''),
});

const postingUploadLimit = bodyLimit({
  maxSize: MAX_UPLOAD_MB * 1024 * 1024,
  onError: () => flashRedirect('/screen/new', 'err', t('upload.tooLarge', { mb: MAX_UPLOAD_MB })),
});

screenRoute.post('/screen', postingUploadLimit, onceGuard(() => 'screen:new', () => '/screen/new'), async (c) => {
  const form = await c.req.parseBody();
  const parsed = NewScreeningSchema.safeParse(form);
  if (!parsed.success) {
    return flashRedirect('/screen/new', 'err', t('screenRoute.notStarted', { issue: firstIssue(parsed.error.issues) }), refusedField(c.req.path, parsed.error.issues));
  }
  const f = parsed.data;

  let jobId: number;
  let jobTitle: string;
  let postingText: string;
  if (f.jobMode === 'existing') {
    const job = f.jobId ? await prisma.job.findUnique({ where: { id: f.jobId }, select: { id: true, title: true, description: true } }) : null;
    if (!job) return flashRedirect('/screen/new', 'err', t('screenRoute.pickJob'));
    jobId = job.id;
    jobTitle = job.title;
    postingText = job.description;
  } else {
    let description = f.description.replace(/\r\n/g, '\n').trim();
    const file = form.file;
    if (file instanceof File && file.size > 0) {
      try {
        description = await extractResumeText(file.name, Buffer.from(await file.arrayBuffer()));
      } catch (err) {
        if (err instanceof ResumeTextError) return flashRedirect('/screen/new', 'err', t('screenRoute.postingFile', { reason: err.reason() }));
        throw err;
      }
    }
    if (!f.title) return flashRedirect('/screen/new', 'err', t('screenRoute.needsTitle'));
    if (description.length < MIN_DESCRIPTION_CHARS) {
      return flashRedirect('/screen/new', 'err', t('screenRoute.needsText', { min: MIN_DESCRIPTION_CHARS }));
    }
    const result = await createManualJob(
      { companyName: f.companyName || 'Your company', title: f.title, url: '', location: f.location, description },
      { classify: false },
    );
    jobId = result.job.id;
    jobTitle = result.job.title;
    postingText = result.job.description;
  }

  const settings = await getSettings();
  const screening = await createScreening({
    jobId,
    title: `${jobTitle} — ${new Date().toISOString().slice(0, 10)}`,
    postingText,
    rubric: draftRubric(null),
    retainUntil: new Date(Date.now() + settings.screeningRetentionDays * DAY_MS),
  });
  logger.info({ screeningId: screening.id, jobId }, 'screening: created');
  return startRubricDraft(c, screening.id, jobId, jobTitle, t('screenRoute.run.reading'));
});

/**
 * The rubric draft is the posting brief (ADR 0044) — one call per posting,
 * cached against its text, so a posting compared with a resume before costs
 * nothing here. Shown on the run page as its one step.
 */
async function startRubricDraft(
  c: { redirect(url: string, status: 303): Response },
  screeningId: number,
  jobId: number,
  jobTitle: string,
  heading: string,
  preset: Preset = 'standard',
): Promise<Response> {
  const { run, joined } = claimRun(`screen-rubric:${screeningId}`, {
    steps: ['brief'],
    jobTitle,
    resumeName: '',
    jobId,
    backUrl: `/screen/${screeningId}`,
    backLabel: t('screenRoute.run.backToScreening'),
    heading: { running: heading, failed: t('screenRoute.run.readFailed') },
    subtitle: t('screenRoute.run.subtitle', { title: jobTitle }),
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const screening = await getScreening(screeningId);
    if (!screening) {
      updateRun(run.id, { stage: 'error', error: t('screenRoute.deletedMeanwhile') });
      return;
    }
    let reason = '';
    const briefed = await briefForPosting(postingOf(screening), { onError: (r) => (reason = r) });
    if (!briefed) {
      updateRun(run.id, {
        stage: 'done',
        resultUrl: `/screen/${screeningId}`,
        flashKind: 'warn',
        flash: reason ? t('screenRoute.run.noRubricReason', { reason }) : t('screenRoute.run.noRubric'),
      });
      return;
    }
    const current = rubricOf(screening);
    const rubric = applyPreset(draftRubric(briefed.brief, current), preset);
    // The first draft keeps version 1; a redraft over an edited rubric is a new yardstick.
    await saveRubric(screeningId, rubric, current.criteria.length > 0 && !rubricEquals(current, rubric));
    updateRun(run.id, {
      results: { brief: briefed.reused ? t('screenRoute.run.briefReused', { line: briefLine(briefed.brief) }) : briefLine(briefed.brief) },
      stage: 'done',
      resultUrl: `/screen/${screeningId}`,
      flash: t('screenRoute.run.drafted', { preset, summary: rubricSummary(rubric) }),
    });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
}

async function loadScreening(id: number) {
  return Number.isInteger(id) ? getScreening(id) : null;
}

async function loadApplicant(id: number) {
  return Number.isInteger(id) ? getApplicant(id) : null;
}

/** Which engine the calls go to — and the warning when it is a personal-subscription CLI (guardrail 5). */
async function engineNote(): Promise<{ label: string; warn: string | null }> {
  const runtime = await getAiRuntime();
  const first = runtime.chainFor('screening')[0];
  if (!first) return { label: t('screenRoute.engine.none'), warn: t('screenRoute.engine.noneWarn') };
  const label = AI_PROVIDER_LABELS[first];
  // A key (under a vendor's API terms) or a local model is fine; a personal plan is the warning.
  const [keys, { openAiBaseUrl }] = await Promise.all([getAiKeys(), getSettings()]);
  if (billingOf(first, billingFacts(keys, openAiBaseUrl)) !== 'plan') return { label, warn: null };
  return {
    label,
    warn: t('screenRoute.engine.planWarn', { label }),
  };
}

screenRoute.get('/screen/:id', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const [applicants, settings, engine] = await Promise.all([listApplicants(screening.id, screening.rubricVersion), getSettings(), engineNote()]);
  const numberOf = new Map(applicants.map((a) => [a.id, a.number]));
  const rows = applicants.map((a) => rowView({ ...a, sameAsNumber: a.sameAsId !== null ? (numberOf.get(a.sameAsId) ?? null) : null }));
  const calibration = calibrate(calibrationRows(applicants), rubricOf(screening));
  const pending = rows.filter((r) => r.status === 'ok' && (r.verdict === null || r.stale)).length;
  return c.html(
    <ScreenDetailPage
      screening={{
        id: screening.id,
        title: screening.title,
        rubricVersion: screening.rubricVersion,
        retainUntil: screening.retainUntil,
        createdAt: screening.createdAt,
        job: { id: screening.job.id, title: screening.job.title, companyName: screening.job.employer ?? screening.job.company.name, location: screening.job.location },
        postingText: screening.postingText,
        postingUpdatedAt: screening.postingUpdatedAt,
        scoredBeforePosting: scoredBeforePosting(rows, screening.postingUpdatedAt),
      }}
      rubric={rubricOf(screening)}
      rows={rows}
      run={screeningRun(screening.id)}
      pending={pending}
      engine={engine}
      calibration={calibration}
      retentionDays={settings.screeningRetentionDays}
      flash={flash(c)}
    />,
    200,
    CLEAR,
  );
});

screenRoute.get('/screen/:id/state', async (c) => {
  const id = idParam(c.req.param('id'));
  const run = screeningRun(id);
  if (!run) return c.json({ running: false, done: 0, failed: 0, total: 0, queued: [], inFlight: [], finished: [] });
  const { screeningId: _id, startedAt: _s, finishedAt: _f, ...view } = run;
  return c.json(view);
});

/** The posting as this screening reads it — edited here, never on the Job (plan §4). */
screenRoute.post('/screen/:id/posting', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const form = await c.req.parseBody();
  const text = typeof form.postingText === 'string' ? form.postingText.replace(/\r\n/g, '\n').trim() : '';
  if (text.length < MIN_DESCRIPTION_CHARS) {
    return flashRedirect(`/screen/${screening.id}#position`, 'err', t('screenRoute.posting.tooShort', { min: MIN_DESCRIPTION_CHARS }));
  }
  if (text.length > MAX_POSTING_CHARS) {
    return flashRedirect(`/screen/${screening.id}#position`, 'err', t('screenRoute.posting.tooLong', { max: MAX_POSTING_CHARS }));
  }
  if (text === screening.postingText) return flashRedirect(`/screen/${screening.id}#position`, 'ok', t('screenRoute.posting.unchanged'));
  await savePosting(screening.id, text);
  logger.info({ screeningId: screening.id, chars: text.length }, 'screening: posting edited');
  return flashRedirect(`/screen/${screening.id}#position`, 'ok', t('screenRoute.posting.saved'));
});

/** "Score everyone again": every readable applicant back through the current rubric and posting. */
screenRoute.post('/screen/:id/run-all', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  // The readable rows' ids only — never the texts of three hundred applicants for a button press.
  const ids = (await listKnownApplicants(screening.id)).map((a) => a.id);
  const outcome = await startScreeningRun(screening.id, { again: ids });
  const back = `/screen/${screening.id}#results`;
  if (outcome.kind === 'nothing') return flashRedirect(back, 'warn', t('screenRoute.runAll.nothing'));
  if (outcome.kind === 'missing') return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  return flashRedirect(back, 'ok', t('screenRoute.runAll.started', { n: ids.length }));
});

screenRoute.post('/screen/:id/rubric', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const previous = rubricOf(screening);
  const parsed = rubricFromForm(await c.req.parseBody(), previous);
  if ('error' in parsed) return flashRedirect(`/screen/${screening.id}#rubric`, 'err', parsed.error);
  const next = parsed.rubric;
  const changed = !rubricEquals(previous, next);
  await saveRubric(screening.id, next, changed);
  return flashRedirect(
    `/screen/${screening.id}#rubric`,
    'ok',
    changed ? t('screenRoute.rubric.saved', { version: screening.rubricVersion + 1, summary: rubricSummary(next) }) : t('screenRoute.rubric.unchanged'),
  );
});

screenRoute.post('/screen/:id/rubric/redraft', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  return startRubricDraft(c, screening.id, screening.job.id, screening.job.title, t('screenRoute.run.readingAgain'));
});

/** A preset: the posting read again, bent to a shape of hiring; the person's own rows survive. */
screenRoute.post('/screen/:id/rubric/preset', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const form = await c.req.parseBody();
  const preset = typeof form.preset === 'string' && (PRESETS as readonly string[]).includes(form.preset) ? (form.preset as Preset) : 'standard';
  return startRubricDraft(c, screening.id, screening.job.id, screening.job.title, t('screenRoute.run.readingAgain'), preset);
});

const batchUploadLimit = (id: string) =>
  bodyLimit({
    maxSize: MAX_BATCH_UPLOAD_MB * 1024 * 1024,
    onError: () => flashRedirect(`/screen/${id}`, 'err', t('screenRoute.upload.tooLarge', { mb: MAX_BATCH_UPLOAD_MB })),
  });

screenRoute.post('/screen/:id/applicants', (c, next) => batchUploadLimit(c.req.param('id'))(c, next), async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const back = `/screen/${screening.id}`;
  // Multi-value field: gotcha 1 — without `all` only the last file survives.
  const form = await c.req.parseBody({ all: true });
  const raw = form.files;
  const picked = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File && f.size > 0);
  if (picked.length === 0) return flashRedirect(back, 'err', t('screenRoute.upload.pickFirst'));

  const uploads = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) })));
  const { files, badArchives, oversized, truncatedArchives, notResumes } = expandUploads(uploads);
  const room = MAX_APPLICANTS_PER_SCREENING - (await countApplicants(screening.id));
  if (room <= 0) return flashRedirect(back, 'err', t('screenRoute.upload.full', { max: MAX_APPLICANTS_PER_SCREENING }));
  const batch = files.slice(0, room);

  const known = await listKnownApplicants(screening.id);
  // Read every file first, then decide the whole upload and write it in one
  // transaction (TASKS H23/H25): the text extraction is the slow part, and it
  // never runs inside the lock.
  const read: {
    file: (typeof batch)[number];
    text: string | null;
    note: string | null;
    redacted: ReturnType<typeof redactApplicant> | null;
    print: { hash: string; simhash: bigint | null };
    leaks: string[];
  }[] = [];
  for (const file of batch) {
    let text: string | null = null;
    let note: string | null = null;
    try {
      text = await extractResumeText(file.name, file.bytes);
    } catch (err) {
      if (err instanceof ResumeTextError) note = err.message;
      else throw err;
    }
    // Redacted once with a placeholder number for the name and email the
    // dedupe reads; the store puts its own number on the label.
    const redacted = text ? redactApplicant(text, 0) : null;
    const print = text ? fingerprintText(text) : { hash: fingerprintBytes(file.bytes), simhash: null };
    // TASKS E4 (Q6): what the redaction missed holds the applicant back from
    // every model until a person has looked. The kinds only — a leak entry
    // names a part of the person.
    const leaks = redacted ? leakKinds(findLeaks(redacted.text, redacted)) : [];
    read.push({ file, text, note, redacted, print, leaks });
  }
  // TASKS E3 (Q9): a cover letter goes to its person and is never scored.
  const signals = read.map((r) => (r.text === null ? null : coverLetterSignal(r.file.name, r.text)));
  const lettersFound = read.flatMap((r, i) => (signals[i] ? [{ ...r, signal: signals[i]! }] : []));
  const documentOf = (r: (typeof read)[number]) => ({ name: r.file.name, archive: r.file.archive, email: r.redacted?.email ?? null, phone: r.redacted?.phone ?? null });
  const planFor = (files: typeof read) => {
    const plan = planIntake(files.map((r) => ({ text: r.text, email: r.redacted?.email ?? null, phone: r.redacted?.phone ?? null, print: r.print })), known);
    return { plan, adding: plan.adds.map(({ file, sameAs }) => ({ ...files[file]!, sameAs })) };
  };
  let resumesRead = read.filter((_, i) => signals[i] === null);
  let { plan, adding } = planFor(resumesRead);
  const found = letterOwners(lettersFound.map(documentOf), adding.map(documentOf), known);
  // A file only its words call a letter, with no resume of its writer beside it,
  // may be a resume that opens politely: it is added as one — a lost applicant
  // costs more than a scored letter. Appended, so every earlier decision (and
  // every owner above) stands.
  const orphans = lettersFound.filter((l, i) => found[i] === null && l.signal === 'text');
  if (orphans.length > 0) {
    resumesRead = [...resumesRead, ...orphans];
    ({ plan, adding } = planFor(resumesRead));
  }
  const lettersRead = lettersFound.filter((l, i) => !(found[i] === null && l.signal === 'text'));
  const owners = found.filter((o, i) => !(o === null && lettersFound[i]!.signal === 'text'));
  const { created, skipped } = await createApplicants(
    screening.id,
    adding.map(({ file, text, note, redacted, print, leaks, sameAs }) => ({
      name: redacted?.name ?? null,
      email: redacted?.email ?? null,
      phone: redacted?.phone ?? null,
      sourceFilename: displayName(file),
      mimeType: mimeOf(file.name),
      original: file.bytes,
      text: text ?? '',
      redactedTextFor: (n: number) => redacted?.text.replaceAll('Applicant №0', `Applicant №${n}`) ?? '',
      redactions: redacted?.redactions ?? [],
      parseStatus: !text ? ('unreadable' as const) : leaks.length > 0 ? ('held' as const) : ('ok' as const),
      parseNote: !text ? note : leaks.length > 0 ? heldNote(leaks) : null,
      sameAs,
      textHash: print.hash,
      simhash: print.simhash,
    })),
  );
  for (const row of created) {
    // Counts only: a leak entry names a part of the person, and a log line is not the place for it.
    const { text, redacted, leaks } = adding[row.input]!;
    logger.info(
      { screeningId: screening.id, applicantId: row.id, number: row.number, status: row.parseStatus, sameAsId: row.sameAsId, chars: text?.length ?? 0, redactions: redacted?.redactions, leaks: leaks.length },
      'screening: applicant added',
    );
  }
  const idOfAdd = new Map(created.map((row) => [row.input, row.id]));
  const attached = lettersRead.flatMap((r, i) => {
    const owner = owners[i] ?? null;
    const applicantId = owner === null ? undefined : 'id' in owner ? owner.id : idOfAdd.get(owner.add);
    return applicantId === undefined ? [] : [{ applicantId, sourceFilename: displayName(r.file), mimeType: mimeOf(r.file.name), original: r.file.bytes, text: r.text ?? '' }];
  });
  const lettersAttached = await createLetters(attached);
  const lettersLeft = lettersRead.length - attached.length;
  const ok = created.filter((r) => r.parseStatus === 'ok').length;
  const held = created.filter((r) => r.parseStatus === 'held').length;
  const unreadable = created.filter((r) => r.parseStatus === 'unreadable').length;
  const versions = created.filter((r) => r.sameAsId !== null).length;
  const repeats = plan.repeats.length + skipped;

  // Scoring starts by itself: the person picked the files, and the run
  // drains, so files added while it works join the same run.
  const rubricEmpty = rubricOf(screening).criteria.length === 0;
  const started = ok > 0 && !rubricEmpty ? await startScreeningRun(screening.id) : null;

  // One clause per thing that happened, in this order; the next step is a sentence of its own.
  const parts = [t('screenRoute.upload.added', { n: ok + held })];
  if (versions > 0) parts.push(t('screenRoute.upload.versions', { n: versions }));
  if (repeats > 0) parts.push(t('screenRoute.upload.repeats', { n: repeats }));
  if (unreadable > 0) parts.push(t('screenRoute.upload.unreadable', { n: unreadable }));
  if (lettersAttached > 0) parts.push(t('screenRoute.upload.lettersAttached', { n: lettersAttached }));
  if (lettersLeft > 0) parts.push(t('screenRoute.upload.lettersLeft', { n: lettersLeft }));
  if (notResumes.length > 0) parts.push(t('screenRoute.upload.notResumes', { n: notResumes.length }));
  if (badArchives.length > 0) parts.push(t('screenRoute.upload.badArchives', { n: badArchives.length }));
  if (oversized.length > 0) parts.push(t('screenRoute.upload.oversized', { n: oversized.length, mb: MAX_UPLOAD_MB }));
  if (truncatedArchives.length > 0) parts.push(t('screenRoute.upload.truncated', { n: truncatedArchives.length, max: MAX_ZIP_ENTRIES }));
  if (files.length > room) parts.push(t('screenRoute.upload.overRoom', { n: files.length - room, max: MAX_APPLICANTS_PER_SCREENING }));
  if (held > 0) parts.push(t('screenRoute.upload.held', { n: held }));
  const tail =
    started?.kind === 'started' || started?.kind === 'joined'
      ? ` ${t('screenRoute.upload.scoringStarted')}`
      : ok > 0 && rubricEmpty
        ? ` ${t('screenRoute.upload.addCriteria')}`
        : '';
  return flashRedirect(`${back}#results`, held > 0 || unreadable > 0 ? 'warn' : 'ok', `${parts.join('; ')}.${tail}`);
});

const BULK_ACTIONS = ['interview', 'hold', 'declined', 'clear', 'again', 'compare', 'delete'] as const;

/** The checked rows, one action (guardrail 1: every decision here is the person's, and logged). */
screenRoute.post('/screen/:id/applicants/bulk', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const back = `/screen/${screening.id}#results`;
  const form = await c.req.parseBody({ all: true });
  const rawIds = form.ids;
  const ids = (Array.isArray(rawIds) ? rawIds : [rawIds])
    .map((v) => (typeof v === 'string' ? idParam(v) : NaN))
    .filter((n) => Number.isInteger(n));
  const action = typeof form.do === 'string' && (BULK_ACTIONS as readonly string[]).includes(form.do) ? (form.do as (typeof BULK_ACTIONS)[number]) : null;
  if (!action) return flashRedirect(back, 'err', t('screenRoute.bulk.pickAction'));
  if (ids.length === 0) return flashRedirect(back, 'warn', t('screenRoute.bulk.tickFirst'));
  switch (action) {
    case 'compare':
      // The ticked rows in the table's order; the compare page says what is wrong with the pick.
      return c.redirect(`/screen/${screening.id}/compare?ids=${ids.join(',')}`, 303);
    case 'delete': {
      const count = await deleteApplicants(screening.id, ids);
      logger.info({ screeningId: screening.id, ids, count }, 'screening: applicants removed by the user');
      return flashRedirect(back, 'ok', t('screenRoute.bulk.removed', { n: count }));
    }
    case 'again': {
      const outcome = await startScreeningRun(screening.id, { again: ids });
      return flashRedirect(
        back,
        'ok',
        outcome.kind === 'joined'
          ? outcome.queued === 0
            ? t('screenRoute.bulk.alreadyQueued')
            : t('screenRoute.bulk.queued', { n: outcome.queued })
          : outcome.kind === 'nothing'
            ? t('screenRoute.bulk.cannotScore')
            : t('screenRoute.bulk.scoringAgain', { n: ids.length }),
      );
    }
    default: {
      const decision: Decision | null = action === 'clear' ? null : action;
      const count = await setDecisionMany(screening.id, ids, decision);
      logger.info({ screeningId: screening.id, ids, decision, count }, 'screening: decisions set by the user');
      return flashRedirect(back, 'ok', decision ? t('screenRoute.bulk.decided', { n: count, decision }) : t('screenRoute.bulk.cleared', { n: count }));
    }
  }
});

/** The person's correction to the computed score, with its reason (ADR 0047 addendum). */
screenRoute.post('/screen/:id/applicants/:aid/adjust', async (c) => {
  const id = idParam(c.req.param('id'));
  const applicant = await loadApplicant(idParam(c.req.param('aid')));
  if (!applicant || applicant.screeningId !== id) return flashRedirect('/screen', 'err', t('screenRoute.applicantGone'));
  const form = await c.req.parseBody();
  const back = safeBack(form.back, `/screen/${id}/applicants/${applicant.id}`);
  const points = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, Math.round(Number(form.points) || 0)));
  const note = typeof form.note === 'string' ? form.note.trim().slice(0, 200) : '';
  if (points !== 0 && note.length === 0) return flashRedirect(back, 'err', t('screenRoute.adjust.sayWhy'));
  await setAdjustment(applicant.id, points, note || null);
  logger.info({ screeningId: id, applicantId: applicant.id, number: applicant.number, points, hasNote: note.length > 0 }, 'screening: score adjusted by the user');
  return flashRedirect(
    back,
    'ok',
    points === 0 ? t('screenRoute.adjust.removed', { n: applicant.number }) : t('screenRoute.adjust.saved', { n: applicant.number, points: `${points > 0 ? '+' : ''}${points}`, note }),
  );
});

// TASKS E4 (Q6): the person read the redacted text the leak check flagged and lets the model read it as it is.
screenRoute.post('/screen/:id/applicants/:aid/release', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const applicant = await loadApplicant(idParam(c.req.param('aid')));
  if (!applicant || applicant.screeningId !== screening.id) return flashRedirect(`/screen/${screening.id}`, 'err', t('screenRoute.applicantGone'));
  const back = `/screen/${screening.id}/applicants/${applicant.id}`;
  if (!(await releaseApplicant(screening.id, applicant.id))) return flashRedirect(back, 'warn', t('screenRoute.release.notHeld', { n: applicant.number }));
  logger.info({ screeningId: screening.id, applicantId: applicant.id, number: applicant.number }, 'screening: held applicant released by the user');
  const rubricEmpty = rubricOf(screening).criteria.length === 0;
  const started = rubricEmpty ? null : await startScreeningRun(screening.id);
  return flashRedirect(back, 'ok', t('screenRoute.release.done', { n: applicant.number, state: started ? 'started' : rubricEmpty ? 'empty' : 'neither' }));
});

function mimeOf(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  return (
    { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', md: 'text/markdown', txt: 'text/plain' }[
      ext ?? ''
    ] ?? 'application/octet-stream'
  );
}

screenRoute.post('/screen/:id/run', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const id = screening.id;
  const outcome = await startScreeningRun(id);
  const back = `/screen/${id}#results`;
  switch (outcome.kind) {
    case 'missing':
      return flashRedirect('/screen', 'err', t('screenRoute.gone'));
    case 'nothing':
      return flashRedirect(back, 'ok', t('screenRoute.run.nothing'));
    case 'joined':
      return flashRedirect(back, 'ok', t('screenRoute.run.joined', { done: outcome.state.done + outcome.state.failed, total: outcome.state.total }));
    case 'started':
      return flashRedirect(back, 'ok', t('screenRoute.run.started', { n: config.AI_CONCURRENCY }));
  }
});

/** "12,7,3" → [12, 7, 3], each once, in the order given. */
function parseIdList(raw: string | undefined): number[] {
  const out: number[] = [];
  for (const part of (raw ?? '').split(',')) {
    const n = idParam(part.trim());
    if (Number.isInteger(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

type Shortlist = { ok: true; applicants: ApplicantWithVerdict[] } | { ok: false; flash: string };

/** The ticked rows as a shortlist (plan §5.1): two to five, each scored under the current rubric. */
async function shortlistOf(screening: ScreeningWithJob, ids: number[]): Promise<Shortlist> {
  if (ids.length < MIN_COMPARE) return { ok: false, flash: t('screenRoute.compare.tickRange', { min: MIN_COMPARE, max: MAX_COMPARE, one: ids.length === 1 ? 'yes' : 'no' }) };
  if (ids.length > MAX_COMPARE) return { ok: false, flash: t('screenRoute.compare.tooMany', { max: MAX_COMPARE, n: ids.length }) };
  // With their texts: a comparison reads them; the table never does.
  const byId = new Map((await listApplicantsWithText(screening.id, screening.rubricVersion, ids)).map((a) => [a.id, a]));
  const applicants: ApplicantWithVerdict[] = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) return { ok: false, flash: t('screenRoute.compare.oneGone') };
    if (a.parseStatus === 'held') return { ok: false, flash: t('screenRoute.compare.held', { n: a.number }) };
    if (a.parseStatus !== 'ok') return { ok: false, flash: t('screenRoute.compare.unreadable', { n: a.number }) };
    if (!a.verdict || a.stale) return { ok: false, flash: t('screenRoute.compare.notScored', { n: a.number, version: screening.rubricVersion }) };
    applicants.push(a);
  }
  return { ok: true, applicants };
}

screenRoute.get('/screen/:id/compare', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const ids = parseIdList(c.req.query('ids'));
  const pick = await shortlistOf(screening, ids);
  if (!pick.ok) return flashRedirect(`/screen/${screening.id}#results`, 'warn', pick.flash);
  const rubric = rubricOf(screening);
  const side = sideBySide(rubric, pick.applicants, new Date());
  const stored = await latestComparison(screening.id, ids);
  const readings = stored ? readStoredComparison(stored.readings) : null;
  const view = readings ? comparisonView(readings, rubric) : null;
  const names = new Map(side.columns.map((col) => [col.number, col.name]));
  return c.html(
    <ScreenComparePage
      screening={{ id: screening.id, title: screening.title, rubricVersion: screening.rubricVersion }}
      side={side}
      comparison={stored && view ? { view, model: stored.model, createdAt: stored.createdAt, rubricVersion: stored.rubricVersion, markdown: comparisonMarkdown(view, names, screening.title) } : null}
      ids={ids.join(',')}
      engine={await engineNote()}
      flash={flash(c)}
    />,
    200,
    CLEAR,
  );
});

screenRoute.post('/screen/:id/compare/ai', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const form = await c.req.parseBody();
  const ids = parseIdList(typeof form.ids === 'string' ? form.ids : undefined);
  const compareUrl = `/screen/${screening.id}/compare?ids=${ids.join(',')}`;
  const pick = await shortlistOf(screening, ids);
  if (!pick.ok) return flashRedirect(`/screen/${screening.id}#results`, 'warn', pick.flash);
  if (rubricOf(screening).criteria.length === 0) return flashRedirect(compareUrl, 'warn', t('screenRoute.compare.writeCriteria'));
  const n = pick.applicants.length;
  const { run, joined } = claimRun(`screen-compare:${screening.id}:${[...ids].sort((a, b) => a - b).join(',')}`, {
    steps: ['compare'],
    jobTitle: screening.job.title,
    resumeName: '',
    jobId: screening.jobId,
    backUrl: compareUrl,
    backLabel: t('screenRoute.compare.back'),
    heading: { running: t('screenRoute.compare.running', { n }), failed: t('screenRoute.compare.failed') },
    subtitle: t('screenRoute.compare.subtitle', { numbers: pick.applicants.map((a) => `№${a.number}`).join(', ') }),
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const fresh = await getScreening(screening.id);
    if (!fresh) {
      updateRun(run.id, { stage: 'error', error: t('screenRoute.deletedMeanwhile') });
      return;
    }
    const outcome = await compareApplicants(fresh, rubricOf(fresh), pick.applicants, await getAiRuntime(), await loadKeywordMatcher());
    updateRun(
      run.id,
      outcome.ok
        ? { stage: 'done', resultUrl: `${compareUrl}#ai`, flash: t('screenRoute.compare.done', { n }) }
        : { stage: 'done', resultUrl: `${compareUrl}#ai`, flashKind: 'warn', flash: t('screenRoute.compare.notRead', { reason: outcome.reason }) },
    );
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

screenRoute.get('/screen/:id/applicants/:aid', async (c) => {
  const applicant = await loadApplicant(idParam(c.req.param('aid')));
  if (!applicant || applicant.screeningId !== idParam(c.req.param('id'))) return flashRedirect('/screen', 'err', t('screenRoute.applicantGone'));
  const s = applicant.screening;
  const sameAsNumber = applicant.sameAsId !== null ? ((await getApplicant(applicant.sameAsId))?.number ?? null) : null;
  const reply = applicant.verdict ? readScreenReply(applicant.verdict.facts) : null;
  const breakdown = applicant.verdict ? readScreenBreakdown(applicant.verdict.breakdown) : null;
  return c.html(
    <ScreenApplicantPage
      screening={{ id: s.id, title: s.title, rubricVersion: s.rubricVersion, job: { id: s.job.id, title: s.job.title, companyName: s.job.employer ?? s.job.company.name } }}
      applicant={{
        id: applicant.id,
        number: applicant.number,
        name: applicant.name,
        email: applicant.email,
        phone: applicant.phone,
        file: applicant.sourceFilename,
        status: applicantStatus(applicant.parseStatus),
        note: applicant.parseNote === null ? null : noteWords(applicant.parseNote),
        decision: applicant.decision,
        decidedAt: applicant.decidedAt,
        sameAs: sameAsNumber,
        adjustment: applicant.scoreAdjustment,
        adjustmentNote: applicant.adjustmentNote,
        redactions: readRedactions(applicant.redactions),
        leaks: applicant.redactedText ? findLeaks(applicant.redactedText, applicant) : [],
        text: applicant.text,
        redactedText: applicant.redactedText,
      }}
      letters={await listLetters(applicant.id)}
      rubric={rubricOf(s)}
      reply={reply}
      breakdown={breakdown}
      stale={applicant.stale}
      model={applicant.verdict?.model ?? null}
      promptVersion={applicant.verdict?.promptVersion ?? null}
      scoredAt={applicant.verdict?.createdAt ?? null}
      now={new Date()}
      flash={flash(c)}
    />,
    200,
    CLEAR,
  );
});

screenRoute.get('/screen/:id/applicants/:aid/file', async (c) => {
  const aid = idParam(c.req.param('aid'));
  const file = Number.isInteger(aid) ? await getApplicantFile(aid) : null;
  if (!file) return c.text(t('http.notFound'), 404);
  const filename = file.sourceFilename.replace(/ \(from .*\)$/, '').replace(/["\r\n]/g, '');
  return c.body(new Uint8Array(file.original), 200, {
    'Content-Type': file.mimeType,
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
});

// A cover letter's own file (TASKS E3) — only through the applicant it is attached to.
screenRoute.get('/screen/:id/applicants/:aid/letters/:lid/file', async (c) => {
  const lid = idParam(c.req.param('lid'));
  const file = Number.isInteger(lid) ? await getLetterFile(lid) : null;
  if (!file || file.applicantId !== idParam(c.req.param('aid'))) return c.text(t('http.notFound'), 404);
  const filename = file.sourceFilename.replace(/ \(from .*\)$/, '').replace(/["\r\n]/g, '');
  return c.body(new Uint8Array(file.original), 200, {
    'Content-Type': file.mimeType,
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
});

screenRoute.post('/screen/:id/applicants/:aid/decision', async (c) => {
  const form = await c.req.parseBody();
  const id = idParam(c.req.param('id'));
  const aid = idParam(c.req.param('aid'));
  const back = safeBack(form.back, `/screen/${id}`);
  const raw = typeof form.decision === 'string' ? form.decision : '';
  const decision = (DECISIONS as readonly string[]).includes(raw) ? (raw as Decision) : null;
  const applicant = await loadApplicant(aid);
  if (!applicant || applicant.screeningId !== id) return flashRedirect('/screen', 'err', t('screenRoute.applicantGone'));
  await setDecision(aid, decision);
  // Guardrail 1: the person's decision is the one write the tool never makes, and it is logged.
  logger.info({ screeningId: id, applicantId: aid, number: applicant.number, decision }, 'screening: decision set by the user');
  return flashRedirect(back, 'ok', decision ? t('screenRoute.decision.set', { n: applicant.number, decision }) : t('screenRoute.decision.cleared', { n: applicant.number }));
});

screenRoute.post('/screen/:id/applicants/:aid/delete', async (c) => {
  const id = idParam(c.req.param('id'));
  const applicant = await loadApplicant(idParam(c.req.param('aid')));
  if (!applicant || applicant.screeningId !== id) return flashRedirect('/screen', 'err', t('screenRoute.applicantGone'));
  await deleteApplicant(applicant.id);
  logger.info({ screeningId: id, applicantId: applicant.id }, 'screening: applicant removed');
  return flashRedirect(`/screen/${id}#results`, 'ok', t('screenRoute.applicant.removed', { n: applicant.number }));
});

/**
 * The table as a file for the hiring manager. A file is data, as its header
 * is: the words the code writes into it (bucket names, the calibration line)
 * are English whatever language the page reads in.
 */
function exportData(id: number) {
  return withLocale('en', () => exportRowsFor(id));
}

async function exportRowsFor(id: number) {
  const screening = await loadScreening(id);
  if (!screening) return null;
  const applicants = await listApplicants(screening.id, screening.rubricVersion);
  const numberOf = new Map(applicants.map((a) => [a.id, a.number]));
  const rows = exportRows(applicants.map((a) => rowView({ ...a, sameAsNumber: a.sameAsId !== null ? (numberOf.get(a.sameAsId) ?? null) : null })));
  const meta = {
    title: screening.title,
    jobTitle: screening.job.title,
    companyName: screening.job.employer ?? screening.job.company.name,
    gates: rubricOf(screening).criteria.filter((x) => x.mode === 'gate').map((x) => x.label),
    createdAt: screening.createdAt,
  };
  return {
    meta,
    rows,
    calibration: calibrate(calibrationRows(applicants), rubricOf(screening)),
    slug: screening.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'screening',
  };
}

screenRoute.get('/screen/:id/export.csv', async (c) => {
  const data = await exportData(idParam(c.req.param('id')));
  if (!data) return c.text(t('http.notFound'), 404);
  return c.body(withLocale('en', () => toCsv(data.meta, data.rows)), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${data.slug}.csv"`,
  });
});

screenRoute.get('/screen/:id/export.md', async (c) => {
  const data = await exportData(idParam(c.req.param('id')));
  if (!data) return c.text(t('http.notFound'), 404);
  return c.body(withLocale('en', () => toMarkdown(data.meta, data.rows, data.calibration)), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${data.slug}.md"`,
  });
});

screenRoute.post('/screen/:id/retain', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const settings = await getSettings();
  const until = new Date(Date.now() + settings.screeningRetentionDays * DAY_MS);
  await extendRetention(screening.id, until);
  return flashRedirect(`/screen/${screening.id}`, 'ok', t('screenRoute.kept', { date: until.toISOString().slice(0, 10) }));
});

screenRoute.post('/screen/:id/delete', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', t('screenRoute.gone'));
  const n = await countApplicants(screening.id);
  await deleteScreening(screening.id);
  logger.info({ screeningId: screening.id, applicants: n }, 'screening: deleted with files');
  return flashRedirect('/screen', 'ok', t('screenRoute.deleted', { title: screening.title, n }));
});
