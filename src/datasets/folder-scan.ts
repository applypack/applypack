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
  kind: RowFormat;
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
  /** `changing`: its size or time moved while it was read — still being written. */
  | { ok: false; why: 'refused' | 'gone' | 'outside' | 'too-large' | 'changing' };

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

const count = (n: number): string => n.toLocaleString('en-US');

/** What the per-file list says about a file that was not read, or not read as jobs. */
export const FILE_NOTES = {
  fresh: 'Changed a moment ago, so it may still be written. The next check reads it.',
  changing: 'It changed while it was read, so it is still being written. The next check reads it.',
  tooLarge: `Larger than ${MAX_BODY_MB} MB, which is more than a file of rows is read at.`,
  refused: 'The system did not let ApplyPack read this file.',
  outside: 'A link, or a file outside the folder. Not read.',
  notRows: 'No rows in it: not a JSON array of objects, JSON Lines, CSV or TSV.',
} as const;

const KIND_BY_EXTENSION: Record<string, RowFormat> = { json: 'json', jsonl: 'jsonl', ndjson: 'jsonl', csv: 'csv', tsv: 'tsv' };

/** What a file is by its name, or null when it is not a file of rows. The content decides the rest (rows.ts). */
export function rowFileKind(relPath: string): RowFormat | null {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? (KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

/**
 * The name filter of a folder that also holds other things: `jobs-*.json`,
 * several separated by commas. `*` is any run of characters and `?` is one,
 * matched against the file's name whatever its case. Nothing = every file.
 */
export function includeMatcher(pattern: string | null | undefined): (relPath: string) => boolean {
  const globs = (pattern ?? '')
    .split(',')
    .map((glob) => glob.trim())
    .filter((glob) => glob.length > 0)
    .map((glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'));
  if (globs.length === 0) return () => true;
  return (relPath) => {
    const name = relPath.slice(relPath.lastIndexOf('/') + 1);
    return globs.some((glob) => glob.test(name));
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

export function planScan(
  listing: readonly ListedFile[],
  ledger: readonly LedgerEntry[],
  now: number,
  include: (relPath: string) => boolean = () => true,
): ScanPlan {
  const known = new Map(ledger.map((entry) => [entry.relPath, entry]));
  const plan: ScanPlan = { read: [], waiting: [], later: [], tooLarge: [], unchanged: 0, other: 0 };
  const due: ListedFile[] = [];
  for (const file of listing) {
    if (rowFileKind(file.relPath) === null || !include(file.relPath)) {
      plan.other++;
      continue;
    }
    const entry = known.get(file.relPath);
    if (entry && sameFile(entry, file) && settled(entry)) plan.unchanged++;
    else if (file.size > MAX_FILE_BYTES) plan.tooLarge.push(file);
    else if (now - file.mtimeMs < SETTLE_MS) plan.waiting.push(file);
    else due.push(file);
  }
  due.sort((a, b) => a.mtimeMs - b.mtimeMs || a.relPath.localeCompare(b.relPath));
  plan.read = due.slice(0, MAX_FILES_PER_LOOK);
  plan.later = due.slice(MAX_FILES_PER_LOOK);
  return plan;
}

/** A file the plan could not read now, as the ledger row that says why. */
export function unreadChange(file: ListedFile, why: 'fresh' | 'tooLarge'): FileChange {
  return { ...file, kind: rowFileKind(file.relPath)!, sha256: null, status: why === 'fresh' ? 'waiting' : 'skipped', detail: FILE_NOTES[why], jobCount: 0 };
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
  if (!got.ok) {
    if (got.why === 'gone') return { change: null, jobs: [], rows: 'none' };
    if (got.why === 'changing') return { change: note('waiting', FILE_NOTES.changing), jobs: [], rows: 'none' };
    if (got.why === 'refused') return { change: note('failed', FILE_NOTES.refused), jobs: [], rows: 'none' };
    return { change: note('skipped', got.why === 'too-large' ? FILE_NOTES.tooLarge : FILE_NOTES.outside), jobs: [], rows: 'none' };
  }
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
