import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { ACCEPTED_EXTENSIONS } from '../resume/resume-text';
import { readZipEntries, ZipError } from '../resume/zip';
import { hamming64, MAX_HAMMING_DISTANCE, simhash64 } from '../fingerprint';

/*
 * Bulk intake of applicant files (TASKS §19 stage 2): what an upload
 * expands to, and how a second copy of the same person is recognised.
 * Pure — the route reads the multipart form and the store writes the rows.
 */

/** A batch is a hiring round, not a talent pool (ADR 0048): the cap keeps one screening one job's applicants. */
export const MAX_APPLICANTS_PER_SCREENING = 300;
export const MAX_FILES_PER_UPLOAD = 100;
/** A zip of a hundred resumes. */
export const MAX_BATCH_UPLOAD_MB = 60;
/** One resume, inflated — the same ceiling as a single upload (upload.ts); a zip entry past it is not read. */
export const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

export interface UploadFile {
  name: string;
  bytes: Buffer;
}

export interface ExpandedFile extends UploadFile {
  /** The archive it came out of, for the table's "from folder.zip" note. */
  archive: string | null;
}

const ZIP_EXTENSION = '.zip';
const SKIPPED_ENTRY = /(^|\/)(__MACOSX\/|\.|~\$|thumbs\.db$)/i;

export function isAcceptedResume(filename: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extname(filename).toLowerCase());
}

/**
 * Zips opened, everything else passed through; entries an OS adds to an
 * archive (`__MACOSX`, dotfiles, Word's `~$` locks) are skipped. Files of
 * a type the extractor cannot read are kept — the intake records them as
 * unreadable, so the table can say which file it was.
 */
export function expandUploads(files: UploadFile[]): { files: ExpandedFile[]; badArchives: string[]; oversized: string[] } {
  const out: ExpandedFile[] = [];
  const badArchives: string[] = [];
  const oversized: string[] = [];
  for (const f of files) {
    if (out.length >= MAX_FILES_PER_UPLOAD) break;
    if (extname(f.name).toLowerCase() !== ZIP_EXTENSION) {
      out.push({ ...f, archive: null });
      continue;
    }
    try {
      const { entries, skipped } = readZipEntries(f.bytes, MAX_ENTRY_BYTES);
      oversized.push(...skipped);
      for (const entry of entries) {
        if (out.length >= MAX_FILES_PER_UPLOAD) break;
        if (SKIPPED_ENTRY.test(entry.name) || entry.data.length === 0) continue;
        out.push({ name: entry.name.split('/').pop() ?? entry.name, bytes: entry.data, archive: f.name });
      }
    } catch (err) {
      if (err instanceof ZipError) badArchives.push(f.name);
      else throw err;
    }
  }
  return { files: out, badArchives, oversized };
}

export interface TextFingerprint {
  hash: string;
  simhash: bigint | null;
}

/** Exact and near-duplicate keys of one resume's text. */
export function fingerprintText(text: string): TextFingerprint {
  const canon = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return { hash: createHash('sha256').update(canon).digest('hex').slice(0, 32), simhash: simhash64(text) };
}

export interface KnownApplicant {
  id: number;
  number: number;
  email: string | null;
  hash: string;
  simhash: bigint | null;
}

/**
 * The earlier applicant this one is a copy of, or null. Same text, same
 * email, or a SimHash within the cross-listing distance (ADR 0018) — a
 * resume re-uploaded with a new date at the top is the same person.
 */
export function findDuplicate(
  candidate: { email: string | null } & TextFingerprint,
  known: KnownApplicant[],
): KnownApplicant | null {
  for (const k of known) {
    if (k.hash === candidate.hash) return k;
    if (candidate.email && k.email && candidate.email.toLowerCase() === k.email.toLowerCase()) return k;
    if (candidate.simhash !== null && k.simhash !== null && hamming64(candidate.simhash, k.simhash) <= MAX_HAMMING_DISTANCE) return k;
  }
  return null;
}
