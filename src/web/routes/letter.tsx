/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { JobStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { createManualJob, MAX_FIELD_CHARS, MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { extractPostingFacts, fallbackTitle } from '../../jobs/posting-extract';
import { checkPostingUrl, fetchPostingText } from '../../jobs/posting-url';
import { generateCoverLetter } from '../../resume/cover-letter';
import { matchResumeToJob } from '../../resume/match';
import { countWords, COVER_TONES, readCoverAngles, type CoverTone } from '../../resume/prompts';
import {
  deleteCoverLettersForResume,
  deleteMatchesForResume,
  getLatestCompanySnapshot,
  getResume,
  listResumes,
  upsertScratchResume,
} from '../../resume/store';
import { verifyJob } from '../../verification/verify';
import { getActiveProfile } from '../../profiles';
import { getSettings, setCoverAngles } from '../../settings';
import { LetterStartPage } from '../pages/letter-start';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { createRun, startRun, updateRun, type RunStep } from '../target-runs';
import {
  MAX_RESUME_NAME_CHARS,
  nameFromFilename,
  readResumeUpload,
  resumeUploadLimit,
} from '../upload';

/*
 * The /letter launcher (F8.3): a searchable picker over tracked jobs, or one
 * "new posting" box taking a URL and/or pasted text → one run:
 * [fetch] → [extract] → [match] → [verify] → letter. Everything slow is a
 * visible run step, so the form never hangs (TASKS §6.2).
 *
 * The default is the FAST path: a pasted posting is stored without a
 * fit-score call, and match / verify are opt-in. A letter the user is
 * waiting on must not queue three analyses it never reads.
 */

const MIN_RESUME_CHARS = 200;
const JOB_PICK_LIMIT = 150;
const PICKABLE: JobStatus[] = ['NEW', 'ALERTED', 'SAVED', 'APPLIED'];
const DAY_MS = 86_400_000;

const LetterFormSchema = z.object({
  jobMode: z.enum(['existing', 'new']),
  jobId: z.coerce.number().int().optional(),
  jobUrl: z.string().trim().max(2000).default(''),
  description: z.string().default(''),
  companyName: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  title: z.string().trim().max(MAX_FIELD_CHARS).default(''),
  resumeMode: z.enum(['existing', 'upload', 'paste']),
  resumeId: z.coerce.number().int().optional(),
  resumeText: z.string().optional().default(''),
  uploadName: z.string().optional().default(''),
  pasteName: z.string().optional().default(''),
});

export const letterRoute = new Hono();

letterRoute.get('/letter', async (c) => {
  const settings = await getSettings();
  // Newest first among the jobs that clear the primary search's threshold —
  // a letter is written for something you would actually apply to, and the
  // freshest of those is the likeliest target. The picker is searchable, so
  // a long list costs nothing.
  const profile = await getActiveProfile();
  const where = {
    status: { in: PICKABLE },
    ...(profile ? { fitScore: { gte: profile.minFitScore } } : {}),
  };
  const [fitting, resumes] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: [{ fetchedAt: 'desc' }],
      take: JOB_PICK_LIMIT,
      include: { company: { select: { name: true } } },
    }),
    listResumes(),
  ]);
  // A brand-new install (or a strict threshold) can filter everything out;
  // an empty picker would read as "you have no jobs", which is a lie.
  const jobs =
    fitting.length > 0
      ? fitting
      : await prisma.job.findMany({
          where: { status: { in: PICKABLE } },
          orderBy: [{ fetchedAt: 'desc' }],
          take: JOB_PICK_LIMIT,
          include: { company: { select: { name: true } } },
        });
  const now = Date.now();
  return c.html(
    <LetterStartPage
      presetUrl={(c.req.query('url') ?? '').slice(0, 2000)}
      jobs={jobs.map((j) => ({
        id: j.id,
        title: j.title,
        companyName: j.company.name,
        fitScore: j.fitScore,
        ageDays: Math.max(0, Math.floor((now - j.fetchedAt.getTime()) / DAY_MS)),
      }))}
      resumes={resumes.map((r) => ({
        id: r.id,
        name: r.name,
        isDefault: r.isDefault,
        version: r.version,
      }))}
      angles={readCoverAngles(settings.coverAngles)}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

letterRoute.post('/letter', resumeUploadLimit('/letter'), async (c) => {
  const form = await c.req.parseBody();
  const parsed = LetterFormSchema.safeParse(form);
  if (!parsed.success) return flashRedirect('/letter', 'err', 'Pick a job source and a resume.');
  const f = parsed.data;
  const tone: CoverTone = COVER_TONES.includes(form.tone as CoverTone)
    ? (form.tone as CoverTone)
    : 'warm';
  const runMatch = form.runMatch === '1';
  const runVerify = form.runVerify === '1';
  const angle = (v: unknown, max = 300) =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : undefined;
  // Same contract as the job-page card: only a submit that carries the angle
  // fields rewrites the saved values. Without the marker they are reused, so
  // a POST that omits them can never wipe what the user typed.
  const fromForm = form.saveAngles === '1';
  const angles = fromForm
    ? {
        whyCompany: angle(form.whyCompany),
        problem: angle(form.problem),
        approach: angle(form.approach),
        notes: angle(form.notes, 500),
      }
    : readCoverAngles((await getSettings()).coverAngles);
  if (fromForm) await setCoverAngles(angles);

  // Resolve the resume inline — bad input fails before anything runs.
  let resume: { id: number; name: string; version: number; text: string; ephemeral: boolean };
  if (f.resumeMode === 'existing') {
    if (!f.resumeId) return flashRedirect('/letter', 'err', 'Pick a resume from the list.');
    const row = await getResume(f.resumeId);
    if (!row || row.hidden) return flashRedirect('/letter', 'err', 'That resume no longer exists.');
    resume = { ...row, ephemeral: false };
  } else if (f.resumeMode === 'upload') {
    const upload = await readResumeUpload(form);
    if ('error' in upload) return flashRedirect('/letter', 'err', upload.error);
    const name =
      f.uploadName.trim().slice(0, MAX_RESUME_NAME_CHARS) || nameFromFilename(upload.sourceFilename);
    resume = { ...(await upsertScratchResume({ name, ...upload })), ephemeral: true };
  } else {
    const text = f.resumeText.replace(/\r\n/g, '\n').trim();
    if (text.length < MIN_RESUME_CHARS) {
      return flashRedirect('/letter', 'err', `The pasted resume is too short — at least ${MIN_RESUME_CHARS} characters.`);
    }
    const name = f.pasteName.trim().slice(0, MAX_RESUME_NAME_CHARS) || 'Pasted resume';
    resume = {
      ...(await upsertScratchResume({
        name,
        sourceFilename: 'pasted.txt',
        mimeType: 'text/plain',
        original: Buffer.from(text, 'utf8'),
        text,
      })),
      ephemeral: true,
    };
  }

  // Resolve the job source. URL and paste both end as a description; the job
  // row itself is created inside the run (deduped, classified when new).
  let existingJob: { id: number; title: string } | null = null;
  let description = '';
  let jobUrl = '';
  let { companyName, title } = f;
  if (f.jobMode === 'existing') {
    if (!f.jobId) return flashRedirect('/letter', 'err', 'Pick a job from the list.');
    const row = await prisma.job.findUnique({ where: { id: f.jobId }, select: { id: true, title: true } });
    if (!row) return flashRedirect('/letter', 'err', 'That job no longer exists.');
    existingJob = row;
  } else {
    // One box for both: pasted text wins, a bare URL gets fetched. Only the
    // cheap shape check runs here — the request itself is a visible run step,
    // so a slow page never looks like a hung form (TASKS §6.2).
    description = f.description.replace(/\r\n/g, '\n').trim();
    jobUrl = f.jobUrl;
    if (description.length === 0) {
      if (!jobUrl) {
        return flashRedirect('/letter', 'err', 'Give a posting URL or paste the posting text.');
      }
      const checked = checkPostingUrl(jobUrl);
      if (!checked.ok) return flashRedirect(`/letter?url=${encodeURIComponent(jobUrl)}`, 'err', checked.error);
    } else if (description.length < MIN_DESCRIPTION_CHARS) {
      return flashRedirect('/letter', 'err', `The pasted posting is too short — at least ${MIN_DESCRIPTION_CHARS} characters.`);
    }
  }

  // Fetch only when there is nothing pasted; a description the user supplied
  // is always the better source than a scraped page.
  const fetchUrl = f.jobMode === 'new' && description.length === 0;
  // Detection is about the company and the title, not about where the text
  // came from: filling both in skips the call even for a fetched page.
  const needExtract = !existingJob && (!companyName || !title);
  const hasSnapshot = existingJob ? (await getLatestCompanySnapshot(existingJob.id)) !== null : false;
  const steps: RunStep[] = [
    ...(fetchUrl ? (['fetch'] as const) : []),
    ...(needExtract ? (['extract'] as const) : []),
    ...(runMatch ? (['match'] as const) : []),
    ...(runVerify && !hasSnapshot ? (['verify'] as const) : []),
    'letter',
  ];
  const run = createRun({
    steps,
    jobTitle: existingJob?.title ?? title ?? 'Detecting the role…',
    resumeName: resume.name,
    jobId: existingJob?.id,
    backUrl: '/letter',
    backLabel: 'Back to Cover letter',
  });

  startRun(run.id, async () => {
    const warnings: string[] = [];
    let job: { id: number; title: string; companyName: string; location: string; description: string; url: string; postedAt: Date };

    if (existingJob) {
      const row = await prisma.job.findUniqueOrThrow({
        where: { id: existingJob.id },
        include: { company: { select: { name: true } } },
      });
      job = { id: row.id, title: row.title, companyName: row.company.name, location: row.location, description: row.description, url: row.url, postedAt: row.postedAt };
    } else {
      let location = '';
      let salaryMin: number | undefined;
      let salaryMax: number | undefined;
      if (fetchUrl) {
        const fetched = await fetchPostingText(jobUrl);
        if (!fetched.ok) {
          // Back-link keeps the URL, so pasting the text is the next click.
          updateRun(run.id, {
            stage: 'error',
            error: fetched.error,
            backUrl: `/letter?url=${encodeURIComponent(jobUrl)}`,
          });
          return;
        }
        description = fetched.text;
        if (needExtract) updateRun(run.id, { stage: 'extract' });
      }
      if (needExtract) {
        const facts = await extractPostingFacts(description);
        companyName = companyName || facts?.company || 'Unknown company';
        title = title || facts?.title || fallbackTitle(description);
        location = facts?.location || '';
        salaryMin = facts?.salaryMin ?? undefined;
        salaryMax = facts?.salaryMax ?? undefined;
        updateRun(run.id, { jobTitle: title });
      }
      // No fit-score call: the letter never reads it and the user is waiting.
      // "Re-classify" on the job page fills it in later, for free time.
      const result = await createManualJob(
        {
          companyName: companyName || 'Unknown company',
          title: title || fallbackTitle(description),
          url: jobUrl,
          location,
          description,
          salaryMin,
          salaryMax,
        },
        { classify: false },
      );
      job = {
        id: result.job.id,
        title: result.job.title,
        companyName: companyName || 'Unknown company',
        location: result.job.location,
        description: result.job.description,
        url: result.job.url,
        postedAt: result.job.postedAt,
      };
      updateRun(run.id, { jobId: job.id });
    }

    if (resume.ephemeral) {
      await deleteMatchesForResume(resume.id);
      await deleteCoverLettersForResume(resume.id);
    }

    if (runMatch) {
      updateRun(run.id, { stage: 'match' });
      const row = await matchResumeToJob(
        { id: resume.id, version: resume.version, text: resume.text },
        { id: job.id, title: job.title, companyName: job.companyName, location: job.location, description: job.description },
      );
      if (!row) warnings.push('The resume match failed, so the letter works from the resume and posting alone.');
    }

    if (steps.includes('verify')) {
      updateRun(run.id, { stage: 'verify' });
      // A duplicate paste can already carry research — never pay for it twice.
      const snapshot = await getLatestCompanySnapshot(job.id);
      if (snapshot === null) {
        const row = await verifyJob({
          id: job.id,
          title: job.title,
          companyName: job.companyName,
          location: job.location,
          url: job.url,
          description: job.description,
          postedAt: job.postedAt,
        });
        if (!row) warnings.push('Company research failed, so company lines stick to the posting.');
      }
    }

    updateRun(run.id, { stage: 'letter' });
    const outcome = await generateCoverLetter(
      { id: resume.id, text: resume.text, version: resume.version },
      { id: job.id, title: job.title, companyName: job.companyName, location: job.location, description: job.description },
      { tone, angles },
    );
    if (outcome.kind === 'ok') {
      updateRun(run.id, {
        stage: 'done',
        resultUrl: `/jobs/${job.id}?letter=${outcome.row.id}#cover-letter`,
        flash: [
          `Letter drafted — ${countWords(outcome.row.text)} words, fact-check ${outcome.row.gateVerdict}.`,
          ...warnings,
        ].join(' '),
      });
    } else if (outcome.kind === 'blocked') {
      updateRun(run.id, {
        stage: 'error',
        error: `The fact checker rejected the letter twice, so nothing was saved. Violations: ${outcome.reasons.join('; ')}.`,
      });
    } else {
      updateRun(run.id, { stage: 'error', error: 'Generation failed — see the web logs.' });
    }
  });

  return c.redirect(`/target/runs/${run.id}`, 303);
});
