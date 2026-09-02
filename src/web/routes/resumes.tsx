/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { logger } from '../../logger';
import { scanResume } from '../../resume/scan';
import { matchResumeToJob } from '../../resume/match';
import { prisma } from '../../db';
import {
  createResume,
  deleteResume,
  getResume,
  getResumeOriginal,
  listFacts,
  listMatchesForResume,
  listResumes,
  replaceResumeFile,
  saveResumeTextVersion,
  setDefaultResume,
} from '../../resume/store';
import { parseWarnings } from '../../resume/parse-warnings';
import { listProfilesForResume } from '../../profiles';
import { createProfileFromResume, newProfileDraft } from '../profile-from-resume';
import { ResumeDetailPage } from '../pages/resume-detail';
import { ResumesPage } from '../pages/resumes';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import {
  MAX_RESUME_NAME_CHARS,
  nameFromFilename,
  readResumeUpload,
  resumeUploadLimit,
} from '../upload';

const MIN_DRAFT_CHARS = 200;

export const resumesRoute = new Hono();

resumesRoute.get('/resumes', async (c) => {
  const [resumes, facts] = await Promise.all([listResumes(), listFacts()]);
  return c.html(
    <ResumesPage resumes={resumes} facts={facts} flash={parseFlashCookie(c.req.header('cookie'))} />,
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
  const scan = await scanResume(resume);
  return scan
    ? flashRedirect(
        `/resumes/${resume.id}`,
        'ok',
        `Uploaded and scanned "${name}". Tip: Settings → Profile → "Fill from a resume" updates your search profile from it.`,
      )
    : flashRedirect(
        `/resumes/${resume.id}`,
        'err',
        `Uploaded "${name}", but the AI scan failed — check the web logs and try "Scan".`,
      );
});

resumesRoute.post('/resumes/:id/replace', resumeUploadLimit('/resumes'), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await getResume(id))) return c.text('Not found', 404);
  const upload = await readResumeUpload(await c.req.parseBody());
  if ('error' in upload) return flashRedirect(`/resumes/${id}`, 'err', upload.error);
  const resume = await replaceResumeFile(id, upload);
  const scan = await scanResume(resume);
  return scan
    ? flashRedirect(`/resumes/${id}`, 'ok', `Version ${resume.version} uploaded and scanned. Now re-run Compare on the job.`)
    : flashRedirect(`/resumes/${id}`, 'err', `Version ${resume.version} uploaded, but the AI scan failed — try "Scan".`);
});

resumesRoute.get('/resumes/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const [resume, matches, linkedProfiles] = await Promise.all([
    getResume(id),
    listMatchesForResume(id),
    listProfilesForResume(id),
  ]);
  if (!resume) return c.text('Not found', 404);
  return c.html(
    <ResumeDetailPage
      resume={resume}
      matches={matches}
      warnings={parseWarnings(resume.text)}
      // The draft the "Create a search" button would save — rendered, not
      // stored (ADR 0015). Only a scanned resume has anything to say.
      search={{
        linkedProfiles,
        draft: resume.scannedAt ? newProfileDraft(resume) : null,
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
  const scan = await scanResume(resume);
  const jobId = Number(form.jobId);
  const job = Number.isFinite(jobId)
    ? await prisma.job.findUnique({ where: { id: jobId }, include: { company: { select: { name: true } } } })
    : null;
  if (job) {
    const match = await matchResumeToJob(resume, {
      id: job.id,
      title: job.title,
      companyName: job.company.name,
      location: job.location,
      description: job.description,
    });
    if (match) {
      return flashRedirect(
        `/jobs/${job.id}/target?match=${match.id}`,
        'ok',
        `Saved as v${resume.version} (text) and re-analyzed: AI match ${match.matchScore}/100.`,
      );
    }
  }
  return flashRedirect(
    `/resumes/${id}`,
    scan ? 'ok' : 'err',
    scan ? `Saved as v${resume.version} (text version).` : `Saved as v${resume.version}, but the scan failed — try "Scan".`,
  );
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
  const scan = await scanResume(resume);
  return scan
    ? flashRedirect(`/resumes/${id}`, 'ok', `Scanned: ${scan.skills.length} skills, ${scan.issues.length} issues.`)
    : flashRedirect(`/resumes/${id}`, 'err', 'Scan failed — see the web logs.');
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

/** "Alex_Doe_Senior_Backend_Resume.docx" → "Alex Doe Senior Backend Resume". */
