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
/** A whole folder at once — the per-screening cap is the real ceiling. */
export const MAX_FILES_PER_UPLOAD = 300;
/** Three hundred PDFs of a page or two. */
export const MAX_BATCH_UPLOAD_MB = 200;
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

export interface ExpandedUploads {
  files: ExpandedFile[];
  badArchives: string[];
  /** Zip entries past MAX_ENTRY_BYTES, not read. */
  oversized: string[];
  /** Files of a type the extractor cannot read (a photo, a spreadsheet) — a folder drop carries them; they are not applicants. */
  notResumes: string[];
}

const ZIP_EXTENSION = '.zip';
const SKIPPED_ENTRY = /(^|\/)(__MACOSX\/|\.|~\$|thumbs\.db$)/i;

export function isAcceptedResume(filename: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extname(filename).toLowerCase());
}

/**
 * Zips opened, everything else passed through; entries an OS adds to an
 * archive (`__MACOSX`, dotfiles, Word's `~$` locks) are skipped, and so is
 * any file of a type the extractor cannot read — a folder dropped whole
 * carries photos and spreadsheets, and those are not applicants. A file
 * name may carry its folder path ("Ivan Petrenko/CV.pdf"): the page sends
 * it that way so a folder per candidate stays readable in the table.
 */
export function expandUploads(files: UploadFile[]): ExpandedUploads {
  const out: ExpandedFile[] = [];
  const badArchives: string[] = [];
  const oversized: string[] = [];
  const notResumes: string[] = [];
  const take = (name: string, bytes: Buffer, archive: string | null): void => {
    if (out.length >= MAX_FILES_PER_UPLOAD) return;
    if (SKIPPED_ENTRY.test(name) || bytes.length === 0) return;
    if (!isAcceptedResume(name)) {
      notResumes.push(name);
      return;
    }
    out.push({ name, bytes, archive });
  };
  for (const f of files) {
    if (out.length >= MAX_FILES_PER_UPLOAD) break;
    if (extname(f.name).toLowerCase() !== ZIP_EXTENSION) {
      take(f.name, f.bytes, null);
      continue;
    }
    try {
      const { entries, skipped } = readZipEntries(f.bytes, MAX_ENTRY_BYTES);
      oversized.push(...skipped);
      for (const entry of entries) take(entry.name, entry.data, f.name);
    } catch (err) {
      if (err instanceof ZipError) badArchives.push(f.name);
      else throw err;
    }
  }
  return { files: out, badArchives, oversized, notResumes };
}

/** "Ivan Petrenko/CV.pdf (from batch.zip)" — what the table shows for a file. */
export function displayName(file: ExpandedFile): string {
  const name = file.name.replace(/^\.?\/+/, '');
  return file.archive ? `${name} (from ${file.archive})` : name;
}

export interface TextFingerprint {
  hash: string;
  simhash: bigint | null;
}

/** Exact and near-duplicate keys of one resume's text. */
/** A file no text came out of is known by its bytes, so the same scan twice is one row and two different scans never collide. */
export function fingerprintBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

export function fingerprintText(text: string): TextFingerprint {
  const canon = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return { hash: createHash('sha256').update(canon).digest('hex').slice(0, 32), simhash: simhash64(text) };
}

export interface KnownApplicant {
  id: number;
  number: number;
  email: string | null;
  phone: string | null;
  hash: string;
  simhash: bigint | null;
}

export type DuplicateKind =
  /** Byte for byte the same text — the file was added before; nothing to score twice. */
  | 'same-text'
  /** The same person (email, phone) or a near-identical text — another document of theirs, scored like any other. */
  | 'same-person';

/**
 * What an incoming resume repeats, if anything. The same text is a re-upload
 * and is not added; the same person with a different document is a second
 * version — a candidate who applied twice, or a folder with a CV and a
 * cover letter — and each version is scored, labelled as №K's.
 */
export function findDuplicate(
  candidate: { email: string | null; phone: string | null } & TextFingerprint,
  known: KnownApplicant[],
): { kind: DuplicateKind; match: KnownApplicant } | null {
  const digits = (s: string | null): string => (s ?? '').replace(/\D/g, '');
  for (const k of known) {
    if (k.hash === candidate.hash) return { kind: 'same-text', match: k };
  }
  for (const k of known) {
    if (candidate.email && k.email && candidate.email.toLowerCase() === k.email.toLowerCase()) return { kind: 'same-person', match: k };
    if (digits(candidate.phone).length >= 9 && digits(candidate.phone) === digits(k.phone)) return { kind: 'same-person', match: k };
    if (candidate.simhash !== null && k.simhash !== null && hamming64(candidate.simhash, k.simhash) <= MAX_HAMMING_DISTANCE) {
      return { kind: 'same-person', match: k };
    }
  }
  return null;
}
