import { extname } from 'node:path';

/*
 * How a resume reads in a <select>: its name, what kind of file it is and
 * which version, then why it is preselected. "· your search hunts with this"
 * read like the name of a search rather than a note on a file, and nothing
 * said the row was the PDF someone had uploaded.
 */

const KIND_BY_EXT: Record<string, string> = {
  '.pdf': 'PDF',
  '.docx': 'DOCX',
  '.md': 'Markdown',
  '.txt': 'Text',
};

export function resumeFileKind(sourceFilename: string): string {
  return KIND_BY_EXT[extname(sourceFilename).toLowerCase()] ?? 'File';
}

export function resumeOptionLabel(
  r: { name: string; version: number; isDefault: boolean; sourceFilename: string },
  note: string | null = null,
): string {
  return [r.name, `${resumeFileKind(r.sourceFilename)} v${r.version}`, note, r.isDefault ? 'default' : null]
    .filter(Boolean)
    .join(' · ');
}

/** Why the job page preselects a resume: a search names it, or its skills overlap the posting most. */
export function preselectNote(reason: 'linked' | 'overlap', searchName: string | null): string {
  if (reason === 'overlap') return 'best skill overlap';
  return searchName ? `used by search "${searchName}"` : 'used by your search';
}
