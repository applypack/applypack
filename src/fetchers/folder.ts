import { FolderError, listFolder, readFolderFile, realFolder } from '../datasets/folder-io';
import { folderAllowed, type FolderRules } from '../datasets/folder-path';
import {
  MAX_ROWS_PER_LOOK,
  includeMatcher,
  judgeFile,
  kindsFor,
  maxBytesOf,
  newestIsMisfit,
  planScan,
  postingFileKind,
  unreadChange,
  unreadVerdict,
  type FileChange,
  type LedgerEntry,
  type ListedFile,
} from '../datasets/folder-scan';
import { readSourceConfig, type Mapping } from '../datasets/map';
import { POSTING_NOTES, needsModel, readPostingFile, savedPostingJob, savedPostingNote, type ModelFacts } from '../datasets/posting-file';
import { extractPostingFacts } from '../jobs/posting-extract';
import { logger } from '../logger';
import type { NormalizedJob } from '../types';
import { stageFolderLook } from './folder-ledger';

/*
 * A folder source (ADR 0062): one look. A folder a tool writes into has its
 * new and changed row files read through the mapper the file import uses; a
 * folder the user saves postings into has each new file read as one posting,
 * with a model asked for its title and company only when the page did not
 * say them. What the look learned about each file is staged for the ledger
 * (folder-ledger.ts) and kept only once the jobs are stored. No request is
 * made, and nothing in the folder is written, moved or deleted.
 */

interface FolderCompany {
  id: number;
  atsToken: string;
  sourceConfig?: unknown;
}

export interface FolderLookOptions {
  now?: Date;
  /** False while fetching is paused: no model is asked, and a posting that needs one waits. */
  scoring?: boolean;
}

const MAP_AGAIN = 'Map it again under Add sources → A folder on this computer.';

export async function fetchFolder(company: FolderCompany, ledger: readonly LedgerEntry[], rules: FolderRules, opts: FolderLookOptions = {}): Promise<NormalizedJob[]> {
  const now = opts.now ?? new Date();
  const config = readSourceConfig(company.sourceConfig);
  if (!config) throw new FolderError('unmapped', `This folder has no column mapping. ${MAP_AGAIN}`);
  const root = await realFolder(company.atsToken);
  const allowed = folderAllowed(root, rules);
  if (!allowed.ok) throw new FolderError('not-allowed', allowed.reason);

  const listing = await listFolder(root);
  const include = includeMatcher(config.include);
  const kindOf = kindsFor(config.holds);
  const { jobs, changes, misfit } = await (config.holds === 'postings'
    ? lookAtPostings(company.id, root, listing, ledger, include, now, opts.scoring !== false)
    : lookAtRows(company.id, root, listing, ledger, include, now, config.mapping));
  stageFolderLook({ companyId: company.id, at: now, seen: listing.filter((f) => kindOf(f.relPath) !== null && include(f.relPath)).map((f) => f.relPath), changes });
  if (misfit) throw new FolderError('unmapped', `The files in this folder no longer fit its column mapping. ${MAP_AGAIN}`);
  return jobs;
}

interface Look {
  jobs: NormalizedJob[];
  changes: FileChange[];
  /** The tool changed what it writes: the source says so until the mapping is saved again. */
  misfit: boolean;
}

/** The hashes of the files already read (hash → path): a copy or a rename brings nothing new. */
const readHashes = (ledger: readonly LedgerEntry[]): Map<string, string> =>
  new Map(ledger.filter((e) => e.status === 'done' && e.sha256 !== null).map((e) => [e.sha256!, e.relPath]));

async function lookAtRows(
  companyId: number,
  root: string,
  listing: ListedFile[],
  ledger: readonly LedgerEntry[],
  include: (relPath: string) => boolean,
  now: Date,
  mapping: Mapping,
): Promise<Look> {
  const plan = planScan(listing, ledger, now.getTime(), include);
  const changes: FileChange[] = [...plan.waiting.map((f) => unreadChange(f, 'fresh')), ...plan.tooLarge.map((f) => unreadChange(f, 'tooLarge'))];
  const readAs = readHashes(ledger);
  const jobs: NormalizedJob[] = [];
  let read = 0;
  let misfits = 0;
  for (const file of plan.read) {
    // Past the ceiling the rest waits, unnoted: the next look plans it again.
    if (jobs.length >= MAX_ROWS_PER_LOOK) break;
    const verdict = judgeFile(file, await readFolderFile(root, file.relPath), mapping, companyId, readAs);
    if (verdict.change) changes.push(verdict.change);
    if (verdict.rows === 'none') continue;
    read++;
    if (verdict.rows === 'misfit') misfits++;
    else {
      readAs.set(verdict.change!.sha256!, file.relPath);
      jobs.push(...verdict.jobs.map((job) => ({ ...job, sourceFile: file.relPath })));
    }
  }
  // Every file read this look misfits, or nothing was read and the newest judged file is one.
  const misfit = (misfits > 0 && misfits === read) || (read === 0 && newestIsMisfit(listing, ledger, include));
  return { jobs, changes, misfit };
}

/** A model's reading of a posting's head, or null when no engine answered: the file's name then stands in for the title. */
async function readWithModel(text: string): Promise<ModelFacts | null> {
  try {
    return await extractPostingFacts(text);
  } catch (err) {
    logger.warn({ err }, 'folder: a saved posting was not read by the model; its file name stands in');
    return null;
  }
}

async function lookAtPostings(
  companyId: number,
  root: string,
  listing: ListedFile[],
  ledger: readonly LedgerEntry[],
  include: (relPath: string) => boolean,
  now: Date,
  scoring: boolean,
): Promise<Look> {
  const plan = planScan(listing, ledger, now.getTime(), include, postingFileKind);
  const changes: FileChange[] = [
    ...plan.waiting.map((f) => unreadChange(f, 'fresh', postingFileKind)),
    ...plan.tooLarge.map((f) => unreadChange(f, 'tooLarge', postingFileKind)),
  ];
  const readAs = readHashes(ledger);
  const jobs: NormalizedJob[] = [];
  for (const file of plan.read) {
    const kind = postingFileKind(file.relPath)!;
    const got = await readFolderFile(root, file.relPath, maxBytesOf(kind));
    if (!got.ok) {
      const change = unreadVerdict(file, kind, got);
      if (change) changes.push(change);
      continue;
    }
    const measured = { ...file, kind, size: got.size, mtimeMs: got.mtimeMs, sha256: got.sha256, jobCount: 0 };
    const twin = readAs.get(got.sha256);
    if (twin !== undefined && twin !== file.relPath) {
      changes.push({ ...measured, status: 'skipped', detail: `The same content as ${twin}, which was read already.` });
      continue;
    }
    const read = await readPostingFile(kind, got.bytes, now);
    if (!read.ok) {
      changes.push({ ...measured, status: 'skipped', detail: read.why });
      continue;
    }
    let model: ModelFacts | null = null;
    if (needsModel(read)) {
      // Paused: nothing is sent to a model, and the file is read again once it may be.
      if (!scoring) {
        changes.push({ ...measured, sha256: null, status: 'waiting', detail: POSTING_NOTES.needsModel });
        continue;
      }
      model = await readWithModel(read.text);
    }
    const job = savedPostingJob({ companyId, relPath: file.relPath, mtimeMs: got.mtimeMs }, read, model);
    changes.push({ ...measured, status: 'done', detail: savedPostingNote(job), jobCount: 1 });
    readAs.set(got.sha256, file.relPath);
    jobs.push(job);
  }
  return { jobs, changes, misfit: false };
}
