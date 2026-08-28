/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { extname } from 'node:path';
import { logger } from '../../logger';
import { ResumeTextError } from '../../resume/docx-text';
import { extractResumeText } from '../../resume/resume-text';
import { scanResume } from '../../resume/scan';
import {
  createResume,
  deleteResume,
  getResume,
  getResumeOriginal,
  listMatchesForResume,
  listResumes,
  replaceResumeFile,
  setDefaultResume,
} from '../../resume/store';
import { ResumeDetailPage } from '../pages/resume-detail';
import { ResumesPage } from '../pages/resumes';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_NAME_CHARS = 100;
const MIME_BY_EXT: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

export const resumesRoute = new Hono();

resumesRoute.get('/resumes', async (c) => {
  const resumes = await listResumes();
  return c.html(
    <ResumesPage resumes={resumes} flash={parseFlashCookie(c.req.header('cookie'))} />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

interface UploadedFile {
  sourceFilename: string;
  mimeType: string;
  original: Buffer;
  text: string;
}

/** Reads the multipart `file` field into bytes + extracted text, or a user-facing error. */
async function readUpload(form: Record<string, unknown>): Promise<UploadedFile | { error: string }> {
  const file = form.file;
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Pick a .docx, .md or .txt file first.' };
  }
  const original = Buffer.from(await file.arrayBuffer());
  try {
    return {
      sourceFilename: file.name,
      mimeType: file.type || MIME_BY_EXT[extname(file.name).toLowerCase()] || 'application/octet-stream',
      original,
      text: extractResumeText(file.name, original),
    };
  } catch (err) {
    if (err instanceof ResumeTextError) return { error: err.message };
    throw err;
  }
}

const uploadLimit = (redirectTo: string) =>
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: () => flashRedirect(redirectTo, 'err', 'File too large — the limit is 2 MB.'),
  });

resumesRoute.post('/resumes', uploadLimit('/resumes'), async (c) => {
  const form = await c.req.parseBody();
  const upload = await readUpload(form);
  if ('error' in upload) return flashRedirect('/resumes', 'err', upload.error);
  const name =
    typeof form.name === 'string' && form.name.trim().length > 0
      ? form.name.trim().slice(0, MAX_NAME_CHARS)
      : nameFromFilename(upload.sourceFilename);
  const resume = await createResume({ name, ...upload });
  const scan = await scanResume(resume);
  return scan
    ? flashRedirect(`/resumes/${resume.id}`, 'ok', `Uploaded and scanned "${name}".`)
    : flashRedirect(
        `/resumes/${resume.id}`,
        'err',
        `Uploaded "${name}", but the AI scan failed — check the web logs and try "Scan".`,
      );
});

resumesRoute.post('/resumes/:id/replace', uploadLimit('/resumes'), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await getResume(id))) return c.text('Not found', 404);
  const upload = await readUpload(await c.req.parseBody());
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
  const [resume, matches] = await Promise.all([getResume(id), listMatchesForResume(id)]);
  if (!resume) return c.text('Not found', 404);
  return c.html(
    <ResumeDetailPage resume={resume} matches={matches} flash={parseFlashCookie(c.req.header('cookie'))} />,
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

/** "Nazar_Boyko_Senior_Backend_Resume.docx" → "Nazar Boyko Senior Backend Resume". */
function nameFromFilename(filename: string): string {
  const base = filename.slice(0, filename.length - extname(filename).length);
  return base.replace(/[_\-\s]+/g, ' ').trim().slice(0, MAX_NAME_CHARS) || 'Resume';
}
