/*
 * One look at a folder a tool writes into (ADR 0062): which files are read
 * now, which wait and which the ledger already answers for. A file is read
 * once; a changed file is read again; a file still being written waits.
 * Nothing here touches the disk — the listing and the ledger are handed in.
 * Pure — tested in folder-scan.test.ts.
 */

import { mapRows, type Mapping } from './map';
import { MAX_BODY_MB, MAX_ROWS, decodeBody, findRows, type RowFormat } from './rows';
import type { NormalizedJob } from '../types';

/** A row file's state in the ledger (`source_file.status`). */
export type FileStatus = 'done' | 'waiting' | 'skipped' | 'failed';

export interface ListedFile {
  /** The path inside the folder, with `/` between its parts on every system. */
  relPath: string;
  size: number;
  /** Whole milliseconds: what a database column keeps. */
  mtimeMs: number;
}

export interface LedgerEntry extends ListedFile {
  sha256: string | null;
  status: FileStatus;
}

/** What a look learned about one file: the row the ledger keeps for it. */
export interface FileChange extends ListedFile {
  kind: FileKind;
  sha256: string | null;
  status: FileStatus;
  /** Why it waits, was skipped or failed — or a note on a read ("the first 2,000 of 3,500 rows"). */
  detail: string | null;
  /** Rows of it handed to the pipeline as jobs. */
  jobCount: number;
}

/** A file as the reader found it (folder-io.ts): its bytes, or why there are none. */
export type FileRead =
  | { ok: true; bytes: Uint8Array; sha256: string; size: number; mtimeMs: number }
  /** `changing`: its size or time moved while it was read — still being written. `unreadable`: the system said `code`. */
  | { ok: false; why: 'refused' | 'gone' | 'outside' | 'too-large' | 'changing' }
  | { ok: false; why: 'unreadable'; code: string };

/** How deep under the folder a file is looked for. */
export const MAX_DEPTH = 3;
/** A folder with more entries than this is not a folder of job files, and is refused whole. */
export const MAX_ENTRIES = 20_000;
/** Files read in one look; the rest wait for the next one. */
export const MAX_FILES_PER_LOOK = 20;
/** Rows handed over in one look: every one past the filter is an AI call, and the tick asks the database about them in one query. */
export const MAX_ROWS_PER_LOOK = 5_000;
/** A file changed more recently than this may still be written. */
export const SETTLE_MS = 10_000;
export const MAX_FILE_BYTES = MAX_BODY_MB * 1024 * 1024;
/** A saved page or a text file: a posting is a few kilobytes, and a page drags its markup along. */
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
/** A PDF or a .docx of a posting: its fonts and images weigh more than its words, and it is parsed on the event loop. */
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const count = (n: number): string => n.toLocaleString('en-US');

/** What the per-file list says about a file that was not read, or not read as jobs. */
export const FILE_NOTES = {
  fresh: 'Changed a moment ago, so it may still be written. The next check reads it.',
  changing: 'It changed while it was read, so it is still being written. The next check reads it.',
  refused: 'The system did not let ApplyPack read this file.',
  outside: 'A link, or a file outside the folder. Not read.',
  notRows: 'No rows in it: not a JSON array of objects, JSON Lines, CSV or TSV.',
} as const;

/** What a folder holds (ADR 0062): the files a tool writes, many rows a file, or postings the user saved, one a file. */
export type FolderHolds = 'rows' | 'postings';

/** A saved posting by its file's name: a web page, plain text, Markdown, a PDF or a Word document. */
export type PostingKind = 'html' | 'txt' | 'md' | 'pdf' | 'docx';
export type FileKind = RowFormat | PostingKind;

const POSTING_KIND_BY_EXTENSION: Record<string, PostingKind> = { html: 'html', htm: 'html', txt: 'txt', md: 'md', markdown: 'md', pdf: 'pdf', docx: 'docx' };

const KIND_BY_EXTENSION: Record<string, RowFormat> = { json: 'json', jsonl: 'jsonl', ndjson: 'jsonl', csv: 'csv', tsv: 'tsv' };

/** What a file is by its name, or null when it is not a file of rows. The content decides the rest (rows.ts). */
export function rowFileKind(relPath: string): RowFormat | null {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? (KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

function extensionOf(relPath: string): string | null {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

/** What a file is as a saved posting, by its name, or null when it is not one. */
export function postingFileKind(relPath: string): PostingKind | null {
  const extension = extensionOf(relPath);
  return extension === null ? null : (POSTING_KIND_BY_EXTENSION[extension] ?? null);
}

/** Which files a folder's looks take: a tool's rows, or the postings saved into it. */
export function kindsFor(holds: FolderHolds): (relPath: string) => FileKind | null {
  return holds === 'postings' ? postingFileKind : rowFileKind;
}

/**
 * What a folder most likely holds, read off its files' names: saved postings
 * when there are more of those than files of rows. An empty folder is taken
 * for one the user will save postings into — the habit people already have;
 * a tool's folder fills with its own files before anyone checks it.
 */
export function guessHolds(listing: readonly ListedFile[], include: (relPath: string) => boolean = () => true): FolderHolds {
  let rows = 0;
  let postings = 0;
  for (const file of listing) {
    if (!include(file.relPath)) continue;
    if (rowFileKind(file.relPath) !== null) rows++;
    else if (postingFileKind(file.relPath) !== null) postings++;
  }
  return rows > postings ? 'rows' : 'postings';
}

/**
 * The files a browser's "Webpage, Complete" save puts beside a page: a folder
 * named after the page (`Job_files`, or localized, `Job-Dateien`) holding its
 * images, scripts and framed documents. A framed `.html` in there is not a
 * posting, so everything under such a folder is passed over.
 */
export function pageResources(listing: readonly ListedFile[]): (relPath: string) => boolean {
  // The pages' names, by the folder they sit in.
  const stems = new Map<string, string[]>();
  for (const { relPath } of listing) {
    if (!/\.html?$/i.test(relPath)) continue;
    const cut = relPath.lastIndexOf('/');
    const parent = cut === -1 ? '' : relPath.slice(0, cut);
    stems.set(parent, [...(stems.get(parent) ?? []), relPath.slice(cut + 1).replace(/\.html?$/i, '')]);
  }
  return (relPath) => {
    const parts = relPath.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i]!;
      const beside = stems.get(parts.slice(0, i).join('/')) ?? [];
      if (beside.some((stem) => dir.length > stem.length && dir.startsWith(stem) && /[_\- .]/.test(dir[stem.length]!))) return true;
    }
    return false;
  };
}

/** The most a file of this kind is read at. */
export function maxBytesOf(kind: FileKind): number {
  if (kind === 'pdf' || kind === 'docx') return MAX_DOCUMENT_BYTES;
  if (kind === 'html' || kind === 'txt' || kind === 'md') return MAX_TEXT_FILE_BYTES;
  return MAX_FILE_BYTES;
}

/** Why a file of this kind was not read, in the per-file list's words. */
export function tooLargeNote(kind: FileKind): string {
  const mb = maxBytesOf(kind) / (1024 * 1024);
  const what = kind === 'pdf' || kind === 'docx' ? 'a document' : kind === 'html' || kind === 'txt' || kind === 'md' ? 'a saved posting' : 'a file of rows';
  return `Larger than ${mb} MB, which is more than ${what} is read at.`;
}

/**
 * One glob against one name, both lower-cased: `*` is any run of characters
 * and `?` is one. A walk with one point of return per star, never a regular
 * expression — `*a*a*a*a*b` as a regex took a minute on a long name, and the
 * pattern is the user's to type.
 */
function globMatches(glob: string, name: string): boolean {
  let g = 0;
  let n = 0;
  let star = -1;
  let after = 0;
  while (n < name.length) {
    if (g < glob.length && (glob[g] === '?' || glob[g] === name[n])) {
      g++;
      n++;
    } else if (g < glob.length && glob[g] === '*') {
      star = g++;
      after = n;
    } else if (star !== -1) {
      g = star + 1;
      n = ++after;
    } else return false;
  }
  while (g < glob.length && glob[g] === '*') g++;
  return g === glob.length;
}

/**
 * The name filter of a folder that also holds other things: `jobs-*.json`,
 * several separated by commas, matched against the file's name whatever its
 * case. Nothing = every file.
 */
export function includeMatcher(pattern: string | null | undefined): (relPath: string) => boolean {
  const globs = (pattern ?? '')
    .toLowerCase()
    .split(',')
    .map((glob) => glob.trim().replace(/\*{2,}/g, '*'))
    .filter((glob) => glob.length > 0);
  if (globs.length === 0) return () => true;
  return (relPath) => {
    const name = relPath.slice(relPath.lastIndexOf('/') + 1).toLowerCase();
    return globs.some((glob) => globMatches(glob, name));
  };
}

export interface ScanPlan {
  /** Read now, the oldest change first. */
  read: ListedFile[];
  /** Changed seconds ago: possibly still being written. */
  waiting: ListedFile[];
  /** Past the per-look ceiling: the next look takes them. */
  later: ListedFile[];
  /** Larger than a file of rows may be: never read. */
  tooLarge: ListedFile[];
  /** Row files the ledger already answers for. */
  unchanged: number;
  /** Not a file of rows by its name, or left out by the name filter. */
  other: number;
}

/**
 * Whether the ledger has the last word on a file that has not changed. A
 * file that waited is looked at again, and so is one the system would not
 * open — a permission is fixed without touching the file. One that was read
 * (it has a hash) and did not fit the mapping is settled like any other: the
 * same bytes give the same answer until the mapping is saved again, which
 * puts such files back to waiting (routes/folders.tsx).
 */
function settled(entry: LedgerEntry): boolean {
  return entry.status === 'done' || entry.status === 'skipped' || (entry.status === 'failed' && entry.sha256 !== null);
}

/** Whether the ledger's entry is the file as it is now. */
function sameFile(a: ListedFile, b: ListedFile): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/**
 * The files to read now, the oldest change first — new and changed files
 * before the ones looked at again (a file that waited, one the system would
 * not open), so a heap of the latter cannot keep what is new from being read.
 * A file dated in the future (a clock, a synced drive) counts as settled: the
 * read itself measures it twice.
 */
export function planScan(
  listing: readonly ListedFile[],
  ledger: readonly LedgerEntry[],
  now: number,
  include: (relPath: string) => boolean = () => true,
  kindOf: (relPath: string) => FileKind | null = rowFileKind,
): ScanPlan {
  const known = new Map(ledger.map((entry) => [entry.relPath, entry]));
  const plan: ScanPlan = { read: [], waiting: [], later: [], tooLarge: [], unchanged: 0, other: 0 };
  const fresh: ListedFile[] = [];
  const again: ListedFile[] = [];
  for (const file of listing) {
    const kind = kindOf(file.relPath);
    if (kind === null || !include(file.relPath)) {
      plan.other++;
      continue;
    }
    const entry = known.get(file.relPath);
    const age = now - file.mtimeMs;
    if (entry && sameFile(entry, file) && settled(entry)) plan.unchanged++;
    else if (file.size > maxBytesOf(kind)) plan.tooLarge.push(file);
    else if (age >= 0 && age < SETTLE_MS) plan.waiting.push(file);
    else (entry && sameFile(entry, file) ? again : fresh).push(file);
  }
  const oldestFirst = (a: ListedFile, b: ListedFile): number => a.mtimeMs - b.mtimeMs || a.relPath.localeCompare(b.relPath);
  const due = [...fresh.sort(oldestFirst), ...again.sort(oldestFirst)];
  plan.read = due.slice(0, MAX_FILES_PER_LOOK);
  plan.later = due.slice(MAX_FILES_PER_LOOK);
  return plan;
}

/** A file the plan could not read now, as the ledger row that says why. */
export function unreadChange(file: ListedFile, why: 'fresh' | 'tooLarge', kindOf: (relPath: string) => FileKind | null = rowFileKind): FileChange {
  const kind = kindOf(file.relPath)!;
  return { ...file, kind, sha256: null, status: why === 'fresh' ? 'waiting' : 'skipped', detail: why === 'fresh' ? FILE_NOTES.fresh : tooLargeNote(kind), jobCount: 0 };
}

/**
 * The ledger row for a file the reader could not hand over: null for one that
 * vanished between the listing and the read. Shared by both kinds of folder.
 */
export function unreadVerdict(file: ListedFile, kind: FileKind, got: Exclude<FileRead, { ok: true }>): FileChange | null {
  const note = (status: FileStatus, detail: string): FileChange => ({ ...file, kind, sha256: null, status, detail, jobCount: 0 });
  if (got.why === 'gone') return null;
  if (got.why === 'changing') return note('waiting', FILE_NOTES.changing);
  if (got.why === 'refused') return note('failed', FILE_NOTES.refused);
  if (got.why === 'unreadable') return note('failed', `The system could not read this file (${got.code}). It is tried again at the next check.`);
  return note('skipped', got.why === 'too-large' ? tooLargeNote(kind) : FILE_NOTES.outside);
}

/**
 * Whether the newest row file the ledger has judged, as it still sits in the
 * folder, did not fit the mapping. A misfit is settled and not read again, so
 * without this the look after it would read nothing and call the source
 * healthy while the tool's latest output is still being thrown away.
 */
export function newestIsMisfit(listing: readonly ListedFile[], ledger: readonly LedgerEntry[], include: (relPath: string) => boolean): boolean {
  const known = new Map(ledger.map((entry) => [entry.relPath, entry]));
  let newest: LedgerEntry | null = null;
  for (const file of listing) {
    if (rowFileKind(file.relPath) === null || !include(file.relPath)) continue;
    const entry = known.get(file.relPath);
    if (!entry || !sameFile(entry, file) || entry.sha256 === null || (entry.status !== 'done' && entry.status !== 'failed')) continue;
    if (newest === null || entry.mtimeMs > newest.mtimeMs) newest = entry;
  }
  return newest?.status === 'failed';
}

export interface FileVerdict {
  /** The ledger row for the file; null for one that vanished between the listing and the read. */
  change: FileChange | null;
  jobs: NormalizedJob[];
  /** Whether its rows were read at all, and whether they fit the mapping: what tells a tool that changed its output. */
  rows: 'none' | 'fit' | 'misfit';
}

/**
 * One planned file after its read: the jobs it gives and what the ledger
 * should say. `readAs` holds the hashes of files already read (hash → path):
 * a copy or a rename brings nothing new. A row that names no date takes the
 * file's — when the tool wrote it. A file where fewer than half the rows read
 * as a job no longer fits the mapping, and none of it is handed over.
 */
export function judgeFile(file: ListedFile, got: FileRead, mapping: Mapping, companyId: number, readAs: ReadonlyMap<string, string>): FileVerdict {
  const kind = rowFileKind(file.relPath)!;
  const note = (status: FileStatus, detail: string | null, extra: Partial<FileChange> = {}): FileChange => ({ ...file, kind, sha256: null, status, detail, jobCount: 0, ...extra });
  if (!got.ok) return { change: unreadVerdict(file, kind, got), jobs: [], rows: 'none' };
  const measured = { size: got.size, mtimeMs: got.mtimeMs, sha256: got.sha256 };
  const twin = readAs.get(got.sha256);
  if (twin !== undefined && twin !== file.relPath) {
    return { change: note('skipped', `The same content as ${twin}, which was read already.`, measured), jobs: [], rows: 'none' };
  }
  const found = findRows(decodeBody(got.bytes));
  if (!found.ok) return { change: note('skipped', FILE_NOTES.notRows, measured), jobs: [], rows: 'none' };
  const mapped = mapRows(found.rows, mapping, companyId, new Date(got.mtimeMs));
  const judged = found.rows.length - mapped.dropped.closed - mapped.repeated;
  if (mapped.jobs.length * 2 < judged) {
    const detail = `Its columns do not fit the mapping: ${count(mapped.jobs.length)} of ${count(found.rows.length)} rows read as a job.`;
    return { change: note('failed', detail, measured), jobs: [], rows: 'misfit' };
  }
  const detail = found.over > 0 ? `The first ${count(MAX_ROWS)} of ${count(MAX_ROWS + found.over)} rows.` : null;
  return { change: note('done', detail, { ...measured, jobCount: mapped.jobs.length }), jobs: mapped.jobs, rows: 'fit' };
}
