/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { logger } from '../../logger';
import { scanResume } from '../../resume/scan';
import type { ResumeScan } from '../../resume/prompts';
import { matchResumeToJob } from '../../resume/match';
import { prisma } from '../../db';
import {
  createResume,
  deleteImpact,
  deleteResume,
  getResume,
  getResumeOriginal,
  listFacts,
  listMatchesForResume,
  listResumes,
  matchStatsByResume,
  replaceResumeFile,
  type ResumeSummary,
  saveResumeTextVersion,
  setDefaultResume,
} from '../../resume/store';
import { parseWarnings } from '../../resume/parse-warnings';
import { listProfilesForResume } from '../../profiles';
import { createProfileFromResume, newProfileDraft } from '../profile-from-resume';
import { ResumeDetailPage } from '../pages/resume-detail';
import { ResumesPage } from '../pages/resumes';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { createRun, startRun, updateRun } from '../target-runs';
import {
  MAX_RESUME_NAME_CHARS,
  nameFromFilename,
  readResumeUpload,
  resumeUploadLimit,
} from '../upload';

const MIN_DRAFT_CHARS = 200;

export const resumesRoute = new Hono();

resumesRoute.get('/resumes', async (c) => {
  const [resumes, facts, stats] = await Promise.all([
    listResumes(),
    listFacts(),
    matchStatsByResume(),
  ]);
  return c.html(
    <ResumesPage
      resumes={resumes.map((r) => ({ ...r, matches: stats.get(r.id) ?? null }))}
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
    subtitle: `"${name}" — headline, tools, seniority. About a minute.`,
    onScanned: () =>
      `Uploaded and scanned "${name}". Tip: Settings → Profile → "Fill from a resume" updates your search profile from it.`,
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
  const [resume, matches, linkedProfiles, impact] = await Promise.all([
    getResume(id),
    listMatchesForResume(id),
    listProfilesForResume(id),
    deleteImpact(id),
  ]);
  if (!resume) return c.text('Not found', 404);
  return c.html(
    <ResumeDetailPage
      resume={resume}
      matches={matches}
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
  const resume = await saveResumeTextVersion(id, text);
  const jobId = Number(form.jobId);
  const job = Number.isFinite(jobId)
    ? await prisma.job.findUnique({ where: { id: jobId }, include: { company: { select: { name: true } } } })
    : null;

  // The version is already saved; scan and match are the slow part. Two AI
  // calls back to back is the worst wait on the site, so it gets a run too.
  const run = createRun({
    steps: job ? ['scan', 'match'] : ['scan'],
    jobTitle: job?.title ?? '',
    resumeName: resume.name,
    jobId: job?.id,
    heading: { running: 'Re-reading your edited resume', failed: 'Could not read the edited resume' },
    subtitle: `Saved as v${resume.version}.${job ? ' Reading it, then scoring it against the posting.' : ''}`,
    backUrl: `/resumes/${id}`,
    backLabel: 'Back to the resume',
  });
  startRun(run.id, async () => {
    const scan = await scanResume(resume);
    if (!job) {
      updateRun(run.id, scan
        ? { stage: 'done', resultUrl: `/resumes/${id}`, flash: `Saved as v${resume.version} (text version).` }
        : { stage: 'error', error: `Saved as v${resume.version}, but the scan failed — try "Scan".` });
      return;
    }
    updateRun(run.id, { stage: 'match' });
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
          flash: `Saved as v${resume.version} (text) and re-analyzed: AI match ${match.matchScore}/100.`,
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
    subtitle: `"${resume.name}" — headline, tools, seniority. About a minute.`,
    onScanned: (scan) => `Scanned: ${scan.skills.length} skills, ${scan.issues.length} issues.`,
    onFailed: 'Scan failed — see the web logs.',
  });
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
  const run = createRun({
    steps: ['scan'],
    jobTitle: '',
    resumeName: name,
    heading: { running: 'Reading your resume', failed: 'Could not read the resume' },
    subtitle: copy.subtitle,
    // The row exists either way, so the error state has somewhere real to go.
    backUrl: `/resumes/${id}`,
    backLabel: 'Back to the resume',
  });
  startRun(run.id, async () => {
    const scan = await scanResume({ id, text });
    updateRun(run.id, scan
      ? { stage: 'done', resultUrl: `/resumes/${id}`, flash: copy.onScanned(scan) }
      : { stage: 'error', error: copy.onFailed });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
}

/** "Alex_Doe_Senior_Backend_Resume.docx" → "Alex Doe Senior Backend Resume". */
