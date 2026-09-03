/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { logger } from '../../logger';
import type { ResumeReview } from '@prisma/client';
import { reviewResume } from '../../resume/review';
import { scanResume } from '../../resume/scan';
import type { ResumeScan } from '../../resume/prompts';
import { matchResumeToJob } from '../../resume/match';
import { prisma } from '../../db';
import {
  createResume,
  deleteImpact,
  deleteResume,
  getLatestReviewForResume,
  getPreviousReview,
  getResume,
  getResumeOriginal,
  latestReviewByResume,
  listFacts,
  listMatchesForResume,
  listResumes,
  matchStatsByResume,
  renameResume,
  replaceResumeFile,
  type ResumeSummary,
  saveReviewAnswer,
  saveResumeTextVersion,
  setDefaultResume,
} from '../../resume/store';
import { readAnswers, unansweredAsks } from '../../resume/answers';
import { deltaSentence, reviewDelta, type ReviewDelta, type ReviewSnapshot } from '../../resume/review-delta';
import { readReviewAdvice, readReviewGrades } from '../../resume/prompts';
import { readReviewPromptVersion } from '../../resume/review-score';
import { parseWarnings } from '../../resume/parse-warnings';
import { listProfilesForResume } from '../../profiles';
import { createProfileFromResume, newProfileDraft } from '../profile-from-resume';
import { ResumeDetailPage } from '../pages/resume-detail';
import { ResumesPage } from '../pages/resumes';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { claimRun, startRun, updateRun } from '../target-runs';
import { hashShortId } from '../../text-utils';
import {
  MAX_RESUME_NAME_CHARS,
  nameFromFilename,
  readResumeUpload,
  resumeUploadLimit,
} from '../upload';

const MIN_DRAFT_CHARS = 200;

export const resumesRoute = new Hono();

resumesRoute.get('/resumes', async (c) => {
  const [resumes, facts, stats, reviews] = await Promise.all([
    listResumes(),
    listFacts(),
    matchStatsByResume(),
    latestReviewByResume(),
  ]);
  return c.html(
    <ResumesPage
      resumes={resumes.map((r) => ({
        ...r,
        matches: stats.get(r.id) ?? null,
        review: reviews.get(r.id) ?? null,
      }))}
      facts={facts}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

resumesRoute.post('/resumes', resumeUploadLimit('/resumes'), async (c) => {
  const form = await c.req.parseBody();
  const upload = await readResumeUpload(form);
  if ('error' in upload) return flashRedirect('/resumes', 'err', upload.error);
  const name =
    typeof form.name === 'string' && form.name.trim().length > 0
      ? form.name.trim().slice(0, MAX_RESUME_NAME_CHARS)
      : nameFromFilename(upload.sourceFilename);
  const resume = await createResume({ name, ...upload });
  return startScanRun(c, resume, {
    subtitle: `"${name}" — headline, tools, seniority. About half a minute.`,
    onScanned: () =>
      `Uploaded and scanned "${name}". "Run strength review" on this page grades it on its own; Settings → Profile → "Fill from a resume" updates your search profile from it.`,
    onFailed: `Uploaded "${name}", but the AI scan failed — check the web logs, then try "Scan".`,
  });
});

resumesRoute.post('/resumes/:id/replace', resumeUploadLimit('/resumes'), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await getResume(id))) return c.text('Not found', 404);
  const upload = await readResumeUpload(await c.req.parseBody());
  if ('error' in upload) return flashRedirect(`/resumes/${id}`, 'err', upload.error);
  const resume = await replaceResumeFile(id, upload);
  return startScanRun(c, resume, {
    subtitle: `"${resume.name}" v${resume.version} — re-reading headline, tools, seniority.`,
    onScanned: () => `Version ${resume.version} uploaded and scanned. Now re-run Compare on the job.`,
    onFailed: `Version ${resume.version} uploaded, but the AI scan failed — try "Scan".`,
  });
});

resumesRoute.get('/resumes/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const [resume, matches, review, linkedProfiles, impact] = await Promise.all([
    getResume(id),
    listMatchesForResume(id),
    getLatestReviewForResume(id),
    listProfilesForResume(id),
    deleteImpact(id),
  ]);
  if (!resume) return c.text('Not found', 404);
  // The run before this one, so the card can say what the edits changed.
  const previous = review ? await getPreviousReview(id, review.id) : null;
  return c.html(
    <ResumeDetailPage
      resume={resume}
      matches={matches}
      review={review}
      answers={readAnswers(resume.answers)}
      reviewDelta={deltaFor(review, previous)}
      deleteImpact={impact}
      warnings={parseWarnings(resume.text)}
      // The draft the "Create a search" button would save — rendered, not
      // stored (ADR 0015). Only a scanned resume has anything to say.
      search={{
        linkedProfiles,
        draft: resume.scannedAt && !resume.hidden ? newProfileDraft(resume) : null,
      }}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

resumesRoute.get('/resumes/:id/download', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const row = await getResumeOriginal(id);
  if (!row) return c.text('Not found', 404);
  const filename = row.sourceFilename.replace(/["\r\n]/g, '');
  return new Response(Buffer.from(row.original), {
    headers: {
      'Content-Type': row.mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

resumesRoute.post('/resumes/:id/draft', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await getResume(id))) return c.text('Not found', 404);
  const form = await c.req.parseBody();
  const text = typeof form.text === 'string' ? form.text.replace(/\r\n/g, '\n').trim() : '';
  if (text.length < MIN_DRAFT_CHARS) {
    return flashRedirect(`/resumes/${id}`, 'err', 'The draft is too short to be a resume.');
  }
  const jobId = Number(form.jobId);
  const job = Number.isFinite(jobId)
    ? await prisma.job.findUnique({ where: { id: jobId }, include: { company: { select: { name: true } } } })
    : null;

  // Claimed BEFORE the save, not after: this route's side effect is a new
  // resume version, so a second submit that got as far as saving would leave
  // a duplicate version behind whatever the run registry then did. Keyed on
  // the text, because that is what the user submitted (issue #76).
  const { run, joined } = claimRun(`draft:${id}:${hashShortId(text)}:${job?.id ?? ''}`, {
    steps: job ? ['scan', 'keywords'] : ['scan'],
    jobTitle: job?.title ?? '',
    resumeName: '',
    jobId: job?.id,
    heading: { running: 'Re-reading your edited resume', failed: 'Could not read the edited resume' },
    subtitle: 'Saving the new version…',
    backUrl: `/resumes/${id}`,
    backLabel: 'Back to the resume',
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);

  // The save happens inside the run, so a failure lands on the progress page
  // as an error instead of stranding a claimed run nothing will ever finish.
  // Scan and match are the slow part after it: two AI calls back to back is
  // the worst wait on the site, which is why this gets a run at all.
  startRun(run.id, async () => {
    const resume = await saveResumeTextVersion(id, text);
    updateRun(run.id, {
      resumeName: resume.name,
      subtitle: `Saved as v${resume.version}.${job ? ' Reading it, then scoring it against the posting.' : ''}`,
    });
    const scan = await scanResume(resume);
    if (!job) {
      updateRun(run.id, scan
        ? { stage: 'done', resultUrl: `/resumes/${id}`, flash: `Saved as v${resume.version} (text version).` }
        : { stage: 'error', error: `Saved as v${resume.version}, but the scan failed — try "Scan".` });
      return;
    }
    updateRun(run.id, { stage: 'keywords' });
    const match = await matchResumeToJob(resume, {
      id: job.id,
      title: job.title,
      companyName: job.company.name,
      location: job.location,
      description: job.description,
    });
    updateRun(run.id, match
      ? {
          stage: 'done',
          resultUrl: `/jobs/${job.id}/target?match=${match.id}`,
          flash: `Saved as v${resume.version} (text) and checked: AI match ${match.matchScore}/100.`,
        }
      : {
          stage: 'error',
          error: `Saved as v${resume.version}, but the comparison failed — see the web logs.`,
        });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/**
 * "Create a search from this resume" — the card above the button already
 * showed exactly what this writes, so one press is enough (ADR 0015).
 */
resumesRoute.post('/resumes/:id/profile', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const resume = await getResume(id);
  if (!resume || resume.hidden) return c.text('Not found', 404);
  if (!resume.scannedAt) {
    return flashRedirect(`/resumes/${id}`, 'err', 'Scan the resume first — the search is built from the scan.');
  }
  const profile = await createProfileFromResume(resume);
  logger.info({ profileId: profile.id, resumeId: id }, 'profile: created from resume');
  return flashRedirect(
    `/settings?tab=profile&profile=${profile.id}`,
    'ok',
    `Created the search "${profile.name}" from "${resume.name}". It is not hunting yet — press Activate to switch to it.`,
  );
});

resumesRoute.post('/resumes/:id/rescan', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const resume = await getResume(id);
  if (!resume) return c.text('Not found', 404);
  return startScanRun(c, resume, {
    subtitle: `"${resume.name}" — headline, tools, seniority. About half a minute.`,
    onScanned: (scan) => `Scanned: ${scan.skills.length} skills, ${scan.issues.length} issues.`,
    onFailed: 'Scan failed — see the web logs.',
  });
});

/** A stored review as the delta reads it; null passes straight through. */
function snapshotOf(review: ResumeReview | null): ReviewSnapshot | null {
  if (!review) return null;
  return {
    score: review.reviewScore,
    version: review.resumeVersion,
    promptVersion: readReviewPromptVersion(review.breakdown),
    grades: readReviewGrades(review.grades).map((g) => ({ dimension: g.dimension, grade: g.grade })),
  };
}

/** What moved between two runs of one resume — null unless both exist. */
function deltaFor(current: ResumeReview | null, previous: ResumeReview | null): ReviewDelta | null {
  const now = snapshotOf(current);
  return now ? reviewDelta(snapshotOf(previous), now) : null;
}

/**
 * "Run strength review" — one AI call, on demand only (resumes-plan §B.1). The
 * run registry shows the rubric being walked instead of a spinner; nothing
 * about the resume changes, so a failure costs the user nothing but the wait.
 */
resumesRoute.post('/resumes/:id/review', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const resume = await getResume(id);
  if (!resume) return c.text('Not found', 404);
  const { text, version, roleTypes, answers } = resume;
  const answered = readAnswers(answers);

  // Two tabs used to start two reviews of the same version and store both
  // (PR #86's follow-up); the second POST now joins the first. The answers are
  // part of the key, hashed rather than counted: correcting a figure leaves the
  // count alone but is a different review, and must not join the run that
  // predates it.
  const { run, joined } = claimRun(`review:${id}:v${version}:${hashShortId(JSON.stringify(answered))}`, {
    steps: ['review'],
    jobTitle: '',
    resumeName: resume.name,
    heading: { running: 'Reviewing your resume', failed: 'Could not review the resume' },
    subtitle: 'Six dimensions, graded against your own text — no job posting involved.',
    backUrl: `/resumes/${id}`,
    backLabel: 'Back to the resume',
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const row = await reviewResume({ id, text, version, roleTypes, answers });
    const delta = deltaFor(row, row ? await getPreviousReview(id, row.id) : null);
    updateRun(run.id, row
      ? {
          stage: 'done',
          resultUrl: `/resumes/${id}`,
          flash: delta
            ? deltaSentence(delta)
            : `Strength ${row.reviewScore}/100 — ${row.headline}`,
        }
      : { stage: 'error', error: 'The review failed — see the web logs.' });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/**
 * One answer to one of the review's questions (ADR 0030 phase 3). No AI call
 * and no re-run: the answer is stored, and the NEXT review reads it. Saying so
 * in the flash matters — this is a button that spends nothing, and the user
 * should know which button does.
 */
resumesRoute.post('/resumes/:id/answers', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const question = typeof form.question === 'string' ? form.question : '';
  const answer = typeof form.answer === 'string' ? form.answer : '';
  if (question.trim().length === 0) return c.text('Bad answer', 400);

  const saved = await saveReviewAnswer(id, question, answer);
  if (saved === null) return c.text('Not found', 404);
  const open = unansweredAsks(
    readReviewAdvice((await getLatestReviewForResume(id))?.advice).map((a) => a.ask),
    saved,
  ).length;
  const cleared = answer.trim().length === 0;
  logger.info({ resumeId: id, answers: saved.length, open, cleared }, 'resume: review answer saved');
  return flashRedirect(
    `/resumes/${id}#resume-strength`,
    'ok',
    cleared
      ? 'Answer removed — the next review will ask again.'
      : `Saved. ${open === 0 ? 'That was the last open question' : `${open} question${open === 1 ? '' : 's'} still open`} — run the review again to fold it in. No AI call was made.`,
  );
});

/**
 * Rename a resume (§12 quick win). The name is what every picker, flash and
 * "applied with" line says, and until now it was whatever the uploaded file
 * happened to be called — `nameFromFilename` on a download from a job board
 * produces things like "Alex Doe Senior Backend Resume (3)".
 */
resumesRoute.post('/resumes/:id/rename', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const name = (typeof form.name === 'string' ? form.name : '').trim().slice(0, MAX_RESUME_NAME_CHARS);
  if (name.length === 0) {
    return flashRedirect(`/resumes/${id}`, 'err', 'A resume needs a name.');
  }
  const renamed = await renameResume(id, name);
  if (!renamed) return c.text('Not found', 404);
  return flashRedirect(`/resumes/${id}`, 'ok', `Renamed to "${name}".`);
});

resumesRoute.post('/resumes/:id/default', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await getResume(id))) return c.text('Not found', 404);
  await setDefaultResume(id);
  return flashRedirect(`/resumes/${id}`, 'ok', 'Default resume updated.');
});

resumesRoute.post('/resumes/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await deleteResume(id);
  logger.info({ id }, 'resume: deleted');
  return flashRedirect('/resumes', 'ok', 'Resume deleted.');
});

/**
 * Upload, replace and rescan all end in the same ~60 s call to the resume
 * model. Awaiting it inline froze the browser on a live form: the submit
 * button stayed enabled, so a second click created a duplicate resume *and*
 * a second AI call. The run registry — already carrying /target and
 * /jobs/:id/match — returns the POST immediately and shows real progress.
 */
function startScanRun(
  c: Context,
  resume: ResumeSummary,
  copy: { subtitle: string; onScanned: (scan: ResumeScan) => string; onFailed: string },
): Response {
  const { id, name, text } = resume;
  const { run, joined } = claimRun(`scan:${id}:${hashShortId(text)}`, {
    steps: ['scan'],
    jobTitle: '',
    resumeName: name,
    heading: { running: 'Reading your resume', failed: 'Could not read the resume' },
    subtitle: copy.subtitle,
    // The row exists either way, so the error state has somewhere real to go.
    backUrl: `/resumes/${id}`,
    backLabel: 'Back to the resume',
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const scan = await scanResume({ id, text });
    updateRun(run.id, scan
      ? { stage: 'done', resultUrl: `/resumes/${id}`, flash: copy.onScanned(scan) }
      : { stage: 'error', error: copy.onFailed });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
}

/** "Alex_Doe_Senior_Backend_Resume.docx" → "Alex Doe Senior Backend Resume". */
