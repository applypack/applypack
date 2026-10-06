import { z } from 'zod';
import { findResumeWithText, getResume, listResumes, upsertScratchResume } from '../resume/store';
import { resumeOptionLabel } from './resume-label';
import type { MatchEvidence } from '../resume/match-mode';
import { MAX_RESUME_NAME_CHARS, nameFromFilename, readResumeUpload } from './upload';
import { t } from '../i18n/t';

/*
 * "Which resume?" on the two launchers (/target, /letter): one of the user's
 * resumes, an uploaded file, or pasted text. A file or a paste lands on the
 * hidden scratch row — a launcher is a one-off and never adds to Resumes.
 */

const MIN_RESUME_CHARS = 200;

/** The resume half of a launcher form; merge it into the route's own schema. */
export const ResumeSourceFields = {
  resumeMode: z.enum(['existing', 'upload', 'paste']),
  resumeId: z.coerce.number().int().optional(),
  resumeText: z.string().optional().default(''),
  uploadName: z.string().optional().default(''),
  pasteName: z.string().optional().default(''),
  /** R1: "This is my own resume" — a file or a paste then gets the owner's facts and other resumes. */
  mine: z.unknown().transform((v) => v === '1' || v === 'on'),
};

const ResumeSourceSchema = z.object(ResumeSourceFields);
export type ResumeSourceInput = z.infer<typeof ResumeSourceSchema>;

export interface ResumeOption {
  id: number;
  isDefault: boolean;
  label: string;
}

/** The launcher's "One of your resumes" list: the Resumes rows, the scratch row never. */
export async function listResumeOptions(): Promise<ResumeOption[]> {
  return (await listResumes()).map((r) => ({ id: r.id, isDefault: r.isDefault, label: resumeOptionLabel(r) }));
}

export interface ResolvedResume {
  id: number;
  name: string;
  version: number;
  text: string;
  /** One of the user's resumes, or a file they said is theirs: judged with their facts and other resumes (R1). */
  evidence: MatchEvidence;
}

/** Resolves the picked source to a resume row, or a user-facing error. Bad files fail here, before any run starts. */
export async function resolveResumeSource(
  form: Record<string, unknown>,
  f: ResumeSourceInput,
): Promise<ResolvedResume | { error: string }> {
  if (f.resumeMode === 'existing') {
    if (!f.resumeId) return { error: t('upload.source.pick') };
    const row = await getResume(f.resumeId);
    if (!row || row.hidden) return { error: t('upload.source.gone') };
    return { ...row, evidence: 'own' };
  }
  // A file that reads exactly like one of the user's own resumes is theirs, checked or not (R16 helps R1).
  const theirs = async (text: string): Promise<MatchEvidence> => (f.mine || (await findResumeWithText(text)) ? 'own' : 'text');
  if (f.resumeMode === 'upload') {
    const upload = await readResumeUpload(form);
    if ('error' in upload) return upload;
    const name = f.uploadName.trim().slice(0, MAX_RESUME_NAME_CHARS) || nameFromFilename(upload.sourceFilename);
    return { ...(await upsertScratchResume({ name, ...upload })), evidence: await theirs(upload.text) };
  }
  const text = f.resumeText.replace(/\r\n/g, '\n').trim();
  if (text.length < MIN_RESUME_CHARS) {
    return { error: t('upload.source.tooShort', { min: MIN_RESUME_CHARS }) };
  }
  const name = f.pasteName.trim().slice(0, MAX_RESUME_NAME_CHARS) || t('upload.pastedName');
  const scratch = await upsertScratchResume({
    name,
    sourceFilename: 'pasted.txt',
    mimeType: 'text/plain',
    original: Buffer.from(text, 'utf8'),
    text,
  });
  return { ...scratch, evidence: await theirs(text) };
}
