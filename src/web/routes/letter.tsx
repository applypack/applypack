/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { JobStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { createManualJob, MAX_FIELD_CHARS, MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { extractPostingFacts, fallbackTitle } from '../../jobs/posting-extract';
import { fetchPostingText } from '../../jobs/posting-url';
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
 * The /letter launcher (F8.2): job by picker / URL fetch / paste + resume by
 * pick / upload / paste → one run: [extract] → [classify] → [match] →
 * [verify] → letter. Match and verify are optional analyses the user opts
 * into; their failure never kills the letter, only annotates the flash.
 */

const MIN_RESUME_CHARS = 200;
const JOB_PICK_LIMIT = 60;
const PICKABLE: JobStatus[] = ['NEW', 'ALERTED', 'SAVED', 'APPLIED'];

const LetterFormSchema = z.object({
  jobMode: z.enum(['existing', 'url', 'paste']),
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
  const [jobs, resumes, settings] = await Promise.all([
    prisma.job.findMany({
      where: { status: { in: PICKABLE } },
      orderBy: [{ fitScore: { sort: 'desc', nulls: 'last' } }, { fetchedAt: 'desc' }],
      take: JOB_PICK_LIMIT,
      include: { company: { select: { name: true } } },
    }),
    listResumes(),
    getSettings(),
  ]);
  return c.html(
    <LetterStartPage
      jobs={jobs.map((j) => ({
        id: j.id,
        title: j.title,
        companyName: j.company.name,
        fitScore: j.fitScore,
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
  } else if (f.jobMode === 'url') {
    if (!f.jobUrl) return flashRedirect('/letter', 'err', 'Paste the posting URL.');
    const fetched = await fetchPostingText(f.jobUrl);
    if (!fetched.ok) return flashRedirect('/letter', 'err', fetched.error);
    description = fetched.text;
    jobUrl = f.jobUrl;
  } else {
    description = f.description.replace(/\r\n/g, '\n').trim();
    if (description.length < MIN_DESCRIPTION_CHARS) {
      return flashRedirect('/letter', 'err', `The pasted posting is too short — at least ${MIN_DESCRIPTION_CHARS} characters.`);
    }
  }

  const needExtract = !existingJob && (!companyName || !title);
  const hasSnapshot = existingJob ? (await getLatestCompanySnapshot(existingJob.id)) !== null : false;
  const steps: RunStep[] = [
    ...(needExtract ? (['extract'] as const) : []),
    ...(existingJob ? [] : (['classify'] as const)),
    ...(runMatch ? (['match'] as const) : []),
    ...(runVerify && !hasSnapshot ? (['verify'] as const) : []),
    'letter',
  ];
  const run = createRun({
    steps,
    jobTitle: existingJob?.title ?? title ?? 'Detecting the role…',
    resumeName: resume.name,
    jobId: existingJob?.id,
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
      if (needExtract) {
        const facts = await extractPostingFacts(description);
        companyName = companyName || facts?.company || 'Unknown company';
        title = title || facts?.title || fallbackTitle(description);
        location = facts?.location || '';
        salaryMin = facts?.salaryMin ?? undefined;
        salaryMax = facts?.salaryMax ?? undefined;
        updateRun(run.id, { stage: 'classify', jobTitle: title });
      }
      const result = await createManualJob({
        companyName: companyName || 'Unknown company',
        title: title || fallbackTitle(description),
        url: jobUrl,
        location,
        description,
        salaryMin,
        salaryMax,
      });
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
