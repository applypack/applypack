import { extname } from 'node:path';
import { bodyLimit } from 'hono/body-limit';
import { logger } from '../logger';
import { ResumeTextError } from '../resume/docx-text';
import { ACCEPTED_EXTENSIONS, extractResumeText } from '../resume/resume-text';
import { flashRedirect } from './flash';

/* Multipart resume upload, shared by /resumes, /resumes/:id/replace, /target and the targeted view's re-upload. */

export const MAX_UPLOAD_MB = 5;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

export interface UploadedResumeFile {
  sourceFilename: string;
  mimeType: string;
  original: Buffer;
  text: string;
}

export const MAX_RESUME_NAME_CHARS = 100;

/** "Alex_Doe-Senior_2026.docx" → "Alex Doe Senior 2026" — default resume name. */
export function nameFromFilename(filename: string): string {
  const base = filename.slice(0, filename.length - extname(filename).length);
  return base.replace(/[_\-\s]+/g, ' ').trim().slice(0, MAX_RESUME_NAME_CHARS) || 'Resume';
}

/** Reads the multipart `file` field into bytes + extracted text, or a user-facing error. */
export async function readResumeUpload(
  form: Record<string, unknown>,
): Promise<UploadedResumeFile | { error: string }> {
  const file = form.file;
  if (!(file instanceof File) || file.size === 0) {
    return { error: `Pick a ${ACCEPTED_EXTENSIONS.join(' / ')} file first.` };
  }
  const original = Buffer.from(await file.arrayBuffer());
  try {
    const started = Date.now();
    const text = await extractResumeText(file.name, original);
    // The parse is the whole cost of an instant check (docs/target-plan.md §3.4).
    logger.info(
      { file: file.name, bytes: original.length, chars: text.length, ms: Date.now() - started },
      'resume: upload parsed',
    );
    return {
      sourceFilename: file.name,
      mimeType: file.type || MIME_BY_EXT[extname(file.name).toLowerCase()] || 'application/octet-stream',
      original,
      text,
    };
  } catch (err) {
    if (err instanceof ResumeTextError) return { error: err.message };
    throw err;
  }
}

/** Middleware: reject bodies over the upload limit with a flash back to `redirectTo`. */
export const resumeUploadLimit = (redirectTo: string) =>
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: () => flashRedirect(redirectTo, 'err', `File too large — the limit is ${MAX_UPLOAD_MB} MB.`),
  });
