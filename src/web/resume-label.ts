import { extname } from 'node:path';
import { t } from '../i18n/t';

/*
 * How a resume reads in a <select>: its name, what kind of file it is and
 * which version, then why it is preselected. "· your search hunts with this"
 * read like the name of a search rather than a note on a file, and nothing
 * said the row was the PDF someone had uploaded.
 */

/** A format's own name is written as it is in every language; "Text" and "File" are words, so the catalog has them. */
const FORMAT_BY_EXT: Record<string, string> = {
  '.pdf': 'PDF',
  '.docx': 'DOCX',
  '.md': 'Markdown',
};

export function resumeFileKind(sourceFilename: string): string {
  const ext = extname(sourceFilename).toLowerCase();
  return FORMAT_BY_EXT[ext] ?? (ext === '.txt' ? t('resume.kind.text') : t('resume.kind.file'));
}

export function resumeOptionLabel(
  r: { name: string; version: number; isDefault: boolean; sourceFilename: string },
  note: string | null = null,
): string {
  return [r.name, `${resumeFileKind(r.sourceFilename)} v${r.version}`, note, r.isDefault ? t('resume.default') : null]
    .filter(Boolean)
    .join(' · ');
}

/** Why the job page preselects a resume: a search names it, or its skills overlap the posting most. */
export function preselectNote(reason: 'linked' | 'overlap', searchName: string | null): string {
  if (reason === 'overlap') return t('resume.preselect.overlap');
  return searchName ? t('resume.preselect.search', { name: searchName }) : t('resume.preselect.yourSearch');
}
