import { z } from 'zod';
import { getResume, upsertScratchResume } from '../resume/store';
import { MAX_RESUME_NAME_CHARS, nameFromFilename, readResumeUpload } from './upload';

/*
 * "Which resume?" on the two launchers (/target, /letter): one of the user's
 * resumes, an uploaded file, or pasted text. A file or a paste lands on the
 * hidden scratch row — a launcher is a one-off and never adds to Resumes.
 */

export const MIN_RESUME_CHARS = 200;

/** The resume half of a launcher form; merge it into the route's own schema. */
export const ResumeSourceFields = {
  resumeMode: z.enum(['existing', 'upload', 'paste']),
  resumeId: z.coerce.number().int().optional(),
  resumeText: z.string().optional().default(''),
  uploadName: z.string().optional().default(''),
  pasteName: z.string().optional().default(''),
};

const ResumeSourceSchema = z.object(ResumeSourceFields);
export type ResumeSourceInput = z.infer<typeof ResumeSourceSchema>;

export interface ResolvedResume {
  id: number;
  name: string;
  version: number;
  text: string;
}

/** Resolves the picked source to a resume row, or a user-facing error. Bad files fail here, before any run starts. */
export async function resolveResumeSource(
  form: Record<string, unknown>,
  f: ResumeSourceInput,
): Promise<ResolvedResume | { error: string }> {
  if (f.resumeMode === 'existing') {
    if (!f.resumeId) return { error: 'Pick a resume from the list.' };
    const row = await getResume(f.resumeId);
    if (!row || row.hidden) return { error: 'That resume no longer exists.' };
    return row;
  }
  if (f.resumeMode === 'upload') {
    const upload = await readResumeUpload(form);
    if ('error' in upload) return upload;
    const name = f.uploadName.trim().slice(0, MAX_RESUME_NAME_CHARS) || nameFromFilename(upload.sourceFilename);
    return upsertScratchResume({ name, ...upload });
  }
  const text = f.resumeText.replace(/\r\n/g, '\n').trim();
  if (text.length < MIN_RESUME_CHARS) {
    return { error: `The pasted resume is too short — at least ${MIN_RESUME_CHARS} characters.` };
  }
  const name = f.pasteName.trim().slice(0, MAX_RESUME_NAME_CHARS) || 'Pasted resume';
  return upsertScratchResume({
    name,
    sourceFilename: 'pasted.txt',
    mimeType: 'text/plain',
    original: Buffer.from(text, 'utf8'),
    text,
  });
}
