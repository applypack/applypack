/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { getAiRuntime } from '../../ai-runtime';
import { AI_PROVIDER_LABELS, PROVIDER_PAID } from '../../ai-engine';
import { config } from '../../config';
import { getSettings } from '../../settings';
import { createManualJob, MAX_FIELD_CHARS, MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { briefForPosting, briefLine } from '../../resume/brief';
import { ResumeTextError } from '../../resume/docx-text';
import { extractResumeText } from '../../resume/resume-text';
import { draftRubric, readRubric, rubricEquals, rubricFromForm, rubricSummary } from '../../screening/rubric';
import { expandUploads, findDuplicate, fingerprintText, isAcceptedResume, MAX_APPLICANTS_PER_SCREENING, MAX_BATCH_UPLOAD_MB, MAX_FILES_PER_UPLOAD } from '../../screening/intake';
import { findLeaks, readRedactions, redactApplicant } from '../../screening/redact';
import { readScreenReply } from '../../screening/prompts';
import { readScreenBreakdown } from '../../screening/score';
import { toCsv, toMarkdown } from '../../screening/export';
import { screeningRun, startScreeningRun } from '../../screening/batch';
import {
  countApplicants,
  createApplicant,
  createScreening,
  DECISIONS,
  deleteApplicant,
  deleteScreening,
  extendRetention,
  getApplicant,
  getApplicantFile,
  getScreening,
  listApplicants,
  listKnownApplicants,
  listScreenings,
  rubricOf,
  saveRubric,
  setDecision,
  type Decision,
} from '../../screening/store';
import { requireEmployerMode } from '../employer-mode';
import { clearFlashCookie, flashRedirect, parseFlashCookie, safeBack } from '../flash';
import { ScreenListPage } from '../pages/screen-list';
import { ScreenNewPage } from '../pages/screen-new';
import { ScreenDetailPage } from '../pages/screen-detail';
import { ScreenApplicantPage } from '../pages/screen-applicant';
import { exportRows, rowView } from '../screen-view';
import { claimRun, startRun, updateRun } from '../target-runs';
import { MAX_UPLOAD_MB } from '../upload';

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
    include: { company: { select: { name: true, atsType: true } } },
  });
  const now = Date.now();
  const options = jobs
    .map((j) => ({
      id: j.id,
      title: j.title,
      companyName: j.company.name,
      manual: j.company.atsType === 'MANUAL',
      ageDays: Math.max(0, Math.floor((now - j.fetchedAt.getTime()) / DAY_MS)),
    }))
    .sort((a, b) => Number(b.manual) - Number(a.manual));
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
  onError: () => flashRedirect('/screen/new', 'err', `File too large — the limit is ${MAX_UPLOAD_MB} MB.`),
});

screenRoute.post('/screen', postingUploadLimit, async (c) => {
  const form = await c.req.parseBody();
  const parsed = NewScreeningSchema.safeParse(form);
  if (!parsed.success) return flashRedirect('/screen/new', 'err', 'The form could not be read.');
  const f = parsed.data;

  let jobId: number;
  let jobTitle: string;
  if (f.jobMode === 'existing') {
    const job = f.jobId ? await prisma.job.findUnique({ where: { id: f.jobId }, select: { id: true, title: true } }) : null;
    if (!job) return flashRedirect('/screen/new', 'err', 'Pick a job from the list, or paste the posting.');
    jobId = job.id;
    jobTitle = job.title;
  } else {
    let description = f.description.replace(/\r\n/g, '\n').trim();
    const file = form.file;
    if (file instanceof File && file.size > 0) {
      try {
        description = await extractResumeText(file.name, Buffer.from(await file.arrayBuffer()));
      } catch (err) {
        if (err instanceof ResumeTextError) return flashRedirect('/screen/new', 'err', `The posting file: ${err.message}`);
        throw err;
      }
    }
    if (!f.title) return flashRedirect('/screen/new', 'err', 'A new posting needs at least its title.');
    if (description.length < MIN_DESCRIPTION_CHARS) {
      return flashRedirect('/screen/new', 'err', `The posting needs at least ${MIN_DESCRIPTION_CHARS} characters of text — paste it or give it as a file.`);
    }
    const result = await createManualJob(
      { companyName: f.companyName || 'Your company', title: f.title, url: '', location: f.location, description },
      { classify: false },
    );
    jobId = result.job.id;
    jobTitle = result.job.title;
  }

  const settings = await getSettings();
  const screening = await createScreening({
    jobId,
    title: `${jobTitle} — ${new Date().toISOString().slice(0, 10)}`,
    rubric: draftRubric(null),
    retainUntil: new Date(Date.now() + settings.screeningRetentionDays * DAY_MS),
  });
  logger.info({ screeningId: screening.id, jobId }, 'screening: created');
  return startRubricDraft(c, screening.id, jobId, jobTitle, 'Reading the posting into a rubric');
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
): Promise<Response> {
  const { run, joined } = claimRun(`screen-rubric:${screeningId}`, {
    steps: ['brief'],
    jobTitle,
    resumeName: '',
    jobId,
    backUrl: `/screen/${screeningId}`,
    backLabel: 'Back to the screening',
    heading: { running: heading, failed: 'The posting could not be read' },
    subtitle: `"${jobTitle}" — the gates, the must-have terms, the level and the sector, for you to edit before anyone is scored`,
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const screening = await getScreening(screeningId);
    if (!screening) {
      updateRun(run.id, { stage: 'error', error: 'The screening was deleted meanwhile.' });
      return;
    }
    const jobInput = {
      id: screening.job.id,
      title: screening.job.title,
      companyName: screening.job.company.name,
      location: screening.job.location,
      description: screening.job.description,
    };
    let reason = '';
    const briefed = await briefForPosting(jobInput, { onError: (r) => (reason = r) });
    if (!briefed) {
      updateRun(run.id, {
        stage: 'done',
        resultUrl: `/screen/${screeningId}`,
        flashKind: 'warn',
        flash: `The posting could not be read into a rubric${reason ? ` (${reason})` : ''} — write the gates and the must-have terms yourself.`,
      });
      return;
    }
    const rubric = draftRubric(briefed.brief);
    const current = rubricOf(screening);
    // The first draft keeps version 1; a redraft over an edited rubric is a new yardstick.
    await saveRubric(screeningId, rubric, !rubricEquals(current, draftRubric(null)) && !rubricEquals(current, rubric));
    updateRun(run.id, {
      results: { brief: briefed.reused ? `Reused this posting's reading — ${briefLine(briefed.brief)}` : briefLine(briefed.brief) },
      stage: 'done',
      resultUrl: `/screen/${screeningId}`,
      flash: `Rubric drafted from the posting: ${rubricSummary(rubric)}. Check it, then add the applicants.`,
    });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
}

/** A path id, or NaN — Prisma throws on a NaN where clause, so every route reads ids through this. */
function idParam(raw: string): number {
  return /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
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
  const first = runtime.chain[0];
  if (!first) return { label: 'no engine', warn: 'No AI engine is usable — set one up on Settings → AI engine before scoring.' };
  const label = AI_PROVIDER_LABELS[first];
  if (PROVIDER_PAID[first]) return { label, warn: null };
  return {
    label,
    warn: `Scoring runs on ${label}, a personal subscription. Other people's resumes go through it under terms you do not control — for applicants' data the defensible path is an API engine under a data-processing agreement, or a local model through the OpenAI-compatible engine. Change the order on Settings → AI engine.`,
  };
}

screenRoute.get('/screen/:id', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', 'That screening no longer exists.');
  const [applicants, settings, engine] = await Promise.all([listApplicants(screening.id, screening.rubricVersion), getSettings(), engineNote()]);
  const rows = applicants.map(rowView);
  const pending = rows.filter((r) => r.status === 'ok' && (r.verdict === null || r.stale)).length;
  return c.html(
    <ScreenDetailPage
      screening={{
        id: screening.id,
        title: screening.title,
        rubricVersion: screening.rubricVersion,
        retainUntil: screening.retainUntil,
        createdAt: screening.createdAt,
        job: { id: screening.job.id, title: screening.job.title, companyName: screening.job.company.name, location: screening.job.location },
      }}
      rubric={rubricOf(screening)}
      rows={rows}
      run={screeningRun(screening.id)}
      pending={pending}
      engine={engine}
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
  if (!run) return c.json({ running: false, done: 0, failed: 0, total: 0 });
  return c.json({ running: run.running, done: run.done, failed: run.failed, total: run.total, lastError: run.lastError });
});

screenRoute.post('/screen/:id/rubric', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', 'That screening no longer exists.');
  const previous = rubricOf(screening);
  const next = rubricFromForm(await c.req.parseBody(), previous);
  const changed = !rubricEquals(previous, next);
  await saveRubric(screening.id, next, changed);
  return flashRedirect(
    `/screen/${screening.id}`,
    'ok',
    changed
      ? `Rubric saved as v${screening.rubricVersion + 1}: ${rubricSummary(next)}. Stored scores are about the old yardstick — press Score to read everyone again.`
      : 'Rubric unchanged.',
  );
});

screenRoute.post('/screen/:id/rubric/redraft', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', 'That screening no longer exists.');
  return startRubricDraft(c, screening.id, screening.job.id, screening.job.title, 'Reading the posting again');
});

const batchUploadLimit = (id: string) =>
  bodyLimit({
    maxSize: MAX_BATCH_UPLOAD_MB * 1024 * 1024,
    onError: () => flashRedirect(`/screen/${id}`, 'err', `Upload too large — the limit is ${MAX_BATCH_UPLOAD_MB} MB per upload.`),
  });

screenRoute.post('/screen/:id/applicants', (c, next) => batchUploadLimit(c.req.param('id'))(c, next), async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', 'That screening no longer exists.');
  const back = `/screen/${screening.id}`;
  // Multi-value field: gotcha 1 — without `all` only the last file survives.
  const form = await c.req.parseBody({ all: true });
  const raw = form.files;
  const picked = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File && f.size > 0);
  if (picked.length === 0) return flashRedirect(back, 'err', 'Pick the resume files or a zip first.');
  if (picked.length > MAX_FILES_PER_UPLOAD) return flashRedirect(back, 'err', `At most ${MAX_FILES_PER_UPLOAD} files per upload.`);

  const uploads = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) })));
  const { files, badArchives, oversized } = expandUploads(uploads);
  const room = MAX_APPLICANTS_PER_SCREENING - (await countApplicants(screening.id));
  if (room <= 0) return flashRedirect(back, 'err', `This screening already holds ${MAX_APPLICANTS_PER_SCREENING} applicants.`);
  const batch = files.slice(0, room);

  const known = await listKnownApplicants(screening.id);
  let ok = 0;
  let unreadable = 0;
  let duplicates = 0;
  let leaked = 0;
  for (const file of batch) {
    let text: string | null = null;
    let note: string | null = null;
    if (!isAcceptedResume(file.name)) note = `not a resume file type (${file.name.split('.').pop() ?? '?'})`;
    else {
      try {
        text = await extractResumeText(file.name, file.bytes);
      } catch (err) {
        if (err instanceof ResumeTextError) note = err.message;
        else throw err;
      }
    }
    // Redacted once with a placeholder number for the name and email the
    // dedupe reads; the store puts its own number on the label.
    const redacted = text ? redactApplicant(text, 0) : null;
    const print = text ? fingerprintText(text) : { hash: `unreadable:${file.name}:${file.bytes.length}`, simhash: null };
    const dup = text ? findDuplicate({ email: redacted?.email ?? null, ...print }, known) : null;
    const leaks = redacted ? findLeaks(redacted.text, redacted) : [];
    if (leaks.length > 0) leaked++;
    const row = await createApplicant({
      screeningId: screening.id,
      name: redacted?.name ?? null,
      email: redacted?.email ?? null,
      phone: redacted?.phone ?? null,
      sourceFilename: file.archive ? `${file.name} (from ${file.archive})` : file.name,
      mimeType: mimeOf(file.name),
      original: file.bytes,
      text: text ?? '',
      redactedTextFor: (n) => redacted?.text.replaceAll('Applicant №0', `Applicant №${n}`) ?? '',
      redactions: redacted?.redactions ?? [],
      parseStatus: !text ? 'unreadable' : dup ? 'duplicate' : 'ok',
      parseNote: !text ? note : dup ? `same person as №${dup.number}` : null,
      duplicateOfId: dup?.id ?? null,
      textHash: print.hash,
      simhash: print.simhash,
    });
    if (!text) unreadable++;
    else if (dup) duplicates++;
    else {
      ok++;
      known.push({ id: row.id, number: row.number, email: redacted?.email ?? null, hash: print.hash, simhash: print.simhash });
    }
    // Counts only: a leak entry names a part of the person, and a log line is not the place for it.
    logger.info(
      { screeningId: screening.id, applicantId: row.id, number: row.number, status: row.parseStatus, chars: text?.length ?? 0, redactions: redacted?.redactions, leaks: leaks.length },
      'screening: applicant added',
    );
  }
  const parts = [`${ok} applicant${ok === 1 ? '' : 's'} added`];
  if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates === 1 ? '' : 's'} kept unscored`);
  if (unreadable > 0) parts.push(`${unreadable} file${unreadable === 1 ? '' : 's'} could not be read`);
  if (badArchives.length > 0) parts.push(`${badArchives.length} archive${badArchives.length === 1 ? '' : 's'} could not be opened`);
  if (oversized.length > 0) parts.push(`${oversized.length} zip entr${oversized.length === 1 ? 'y' : 'ies'} over ${MAX_UPLOAD_MB} MB left out`);
  if (files.length > room) parts.push(`${files.length - room} left out — the screening holds ${MAX_APPLICANTS_PER_SCREENING} at most`);
  if (leaked > 0) parts.push(`${leaked} may still carry something identifying — check their scorecards`);
  return flashRedirect(`${back}#results`, leaked > 0 || unreadable > 0 ? 'warn' : 'ok', `${parts.join('; ')}. Names and contacts were removed from what the model will read.`);
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
  const id = idParam(c.req.param('id'));
  const outcome = await startScreeningRun(id);
  const back = `/screen/${id}#results`;
  switch (outcome.kind) {
    case 'missing':
      return flashRedirect('/screen', 'err', 'That screening no longer exists.');
    case 'nothing':
      return flashRedirect(back, 'ok', 'Everyone readable is already scored under this rubric.');
    case 'joined':
      return flashRedirect(back, 'ok', `Already scoring — ${outcome.state.done + outcome.state.failed} of ${outcome.state.total} done.`);
    case 'started':
      return flashRedirect(
        back,
        'ok',
        `Scoring ${outcome.state.total} applicant${outcome.state.total === 1 ? '' : 's'}, ${config.AI_CONCURRENCY} at a time. Each is one independent call; verdicts land as they arrive and survive a restart.`,
      );
  }
});

screenRoute.get('/screen/:id/applicants/:aid', async (c) => {
  const applicant = await loadApplicant(idParam(c.req.param('aid')));
  if (!applicant || applicant.screeningId !== idParam(c.req.param('id'))) return flashRedirect('/screen', 'err', 'That applicant no longer exists.');
  const s = applicant.screening;
  const reply = applicant.verdict ? readScreenReply(applicant.verdict.facts) : null;
  const breakdown = applicant.verdict ? readScreenBreakdown(applicant.verdict.breakdown) : null;
  return c.html(
    <ScreenApplicantPage
      screening={{ id: s.id, title: s.title, rubricVersion: s.rubricVersion, job: { id: s.job.id, title: s.job.title, companyName: s.job.company.name } }}
      applicant={{
        id: applicant.id,
        number: applicant.number,
        name: applicant.name,
        email: applicant.email,
        phone: applicant.phone,
        file: applicant.sourceFilename,
        status: applicant.parseStatus === 'unreadable' || applicant.parseStatus === 'duplicate' ? applicant.parseStatus : 'ok',
        note: applicant.parseNote,
        decision: applicant.decision,
        decidedAt: applicant.decidedAt,
        redactions: readRedactions(applicant.redactions),
        leaks: applicant.redactedText ? findLeaks(applicant.redactedText, applicant) : [],
        text: applicant.text,
        redactedText: applicant.redactedText,
      }}
      rubric={rubricOf(s)}
      reply={reply}
      breakdown={breakdown}
      stale={applicant.stale}
      model={applicant.verdict?.model ?? null}
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
  if (!file) return c.text('Not found', 404);
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
  if (!applicant || applicant.screeningId !== id) return flashRedirect('/screen', 'err', 'That applicant no longer exists.');
  await setDecision(aid, decision);
  // Guardrail 1: the person's decision is the one write the tool never makes, and it is logged.
  logger.info({ screeningId: id, applicantId: aid, number: applicant.number, decision }, 'screening: decision set by the user');
  return flashRedirect(back, 'ok', decision ? `№${applicant.number}: ${decision === 'interview' ? 'to interview' : decision === 'hold' ? 'on hold' : 'declined'}.` : `№${applicant.number}: decision cleared.`);
});

screenRoute.post('/screen/:id/applicants/:aid/delete', async (c) => {
  const id = idParam(c.req.param('id'));
  const applicant = await loadApplicant(idParam(c.req.param('aid')));
  if (!applicant || applicant.screeningId !== id) return flashRedirect('/screen', 'err', 'That applicant no longer exists.');
  await deleteApplicant(applicant.id);
  logger.info({ screeningId: id, applicantId: applicant.id }, 'screening: applicant removed');
  return flashRedirect(`/screen/${id}#results`, 'ok', `№${applicant.number} removed with the file and every verdict.`);
});

async function exportData(id: number) {
  const screening = await loadScreening(id);
  if (!screening) return null;
  const rows = exportRows((await listApplicants(screening.id, screening.rubricVersion)).map(rowView));
  const meta = {
    title: screening.title,
    jobTitle: screening.job.title,
    companyName: screening.job.company.name,
    gates: rubricOf(screening).gates,
    createdAt: screening.createdAt,
  };
  return { meta, rows, slug: screening.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'screening' };
}

screenRoute.get('/screen/:id/export.csv', async (c) => {
  const data = await exportData(idParam(c.req.param('id')));
  if (!data) return c.text('Not found', 404);
  return c.body(toCsv(data.meta, data.rows), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${data.slug}.csv"`,
  });
});

screenRoute.get('/screen/:id/export.md', async (c) => {
  const data = await exportData(idParam(c.req.param('id')));
  if (!data) return c.text('Not found', 404);
  return c.body(toMarkdown(data.meta, data.rows), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${data.slug}.md"`,
  });
});

screenRoute.post('/screen/:id/retain', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', 'That screening no longer exists.');
  const settings = await getSettings();
  const until = new Date(Date.now() + settings.screeningRetentionDays * DAY_MS);
  await extendRetention(screening.id, until);
  return flashRedirect(`/screen/${screening.id}`, 'ok', `Kept until ${until.toISOString().slice(0, 10)}.`);
});

screenRoute.post('/screen/:id/delete', async (c) => {
  const screening = await loadScreening(idParam(c.req.param('id')));
  if (!screening) return flashRedirect('/screen', 'err', 'That screening no longer exists.');
  const n = await countApplicants(screening.id);
  await deleteScreening(screening.id);
  logger.info({ screeningId: screening.id, applicants: n }, 'screening: deleted with files');
  return flashRedirect('/screen', 'ok', `"${screening.title}" deleted with ${n} applicant file${n === 1 ? '' : 's'} and every verdict.`);
});
