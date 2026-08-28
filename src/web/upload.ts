import { extname } from 'node:path';
import { bodyLimit } from 'hono/body-limit';
import { ResumeTextError } from '../resume/docx-text';
import { extractResumeText } from '../resume/resume-text';
import { flashRedirect } from './flash';

/* Multipart resume upload, shared by /resumes, /resumes/:id/replace and the targeted view's re-upload. */

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MIME_BY_EXT: Record<string, string> = {
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

/** Reads the multipart `file` field into bytes + extracted text, or a user-facing error. */
export async function readResumeUpload(
  form: Record<string, unknown>,
): Promise<UploadedResumeFile | { error: string }> {
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

/** Middleware: reject bodies over the upload limit with a flash back to `redirectTo`. */
export const resumeUploadLimit = (redirectTo: string) =>
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: () => flashRedirect(redirectTo, 'err', 'File too large — the limit is 2 MB.'),
  });
