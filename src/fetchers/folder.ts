import { FolderError, listFolder, readFolderFile, realFolder } from '../datasets/folder-io';
import { folderAllowed, type FolderRules } from '../datasets/folder-path';
import { MAX_ROWS_PER_LOOK, includeMatcher, judgeFile, planScan, rowFileKind, unreadChange, type FileChange, type LedgerEntry } from '../datasets/folder-scan';
import { readSourceConfig } from '../datasets/map';
import type { NormalizedJob } from '../types';
import { stageFolderLook } from './folder-ledger';

/*
 * A folder a tool writes into (ADR 0062): one look. New and changed row
 * files are read through the mapper the file import uses and their rows
 * returned as jobs; what the look learned about each file is staged for the
 * ledger (folder-ledger.ts) and kept only once those jobs are stored. No
 * request is made, and nothing in the folder is written, moved or deleted.
 */

interface FolderCompany {
  id: number;
  atsToken: string;
  sourceConfig?: unknown;
}

const MAP_AGAIN = 'Map it again under Add sources → A folder on this computer.';

export async function fetchFolder(company: FolderCompany, ledger: readonly LedgerEntry[], rules: FolderRules, now = new Date()): Promise<NormalizedJob[]> {
  const config = readSourceConfig(company.sourceConfig);
  if (!config) throw new FolderError('unmapped', `This folder has no column mapping. ${MAP_AGAIN}`);
  const root = await realFolder(company.atsToken);
  const allowed = folderAllowed(root, rules);
  if (!allowed.ok) throw new FolderError('not-allowed', allowed.reason);

  const listing = await listFolder(root);
  const include = includeMatcher(config.include);
  const plan = planScan(listing, ledger, now.getTime(), include);
  const changes: FileChange[] = [...plan.waiting.map((f) => unreadChange(f, 'fresh')), ...plan.tooLarge.map((f) => unreadChange(f, 'tooLarge'))];
  const readAs = new Map(ledger.filter((e) => e.status === 'done' && e.sha256 !== null).map((e) => [e.sha256!, e.relPath]));
  const jobs: NormalizedJob[] = [];
  let read = 0;
  let misfits = 0;
  for (const file of plan.read) {
    // Past the ceiling the rest waits, unnoted: the next look plans it again.
    if (jobs.length >= MAX_ROWS_PER_LOOK) break;
    const verdict = judgeFile(file, await readFolderFile(root, file.relPath), config.mapping, company.id, readAs);
    if (verdict.change) changes.push(verdict.change);
    if (verdict.rows === 'none') continue;
    read++;
    if (verdict.rows === 'misfit') misfits++;
    else {
      readAs.set(verdict.change!.sha256!, file.relPath);
      jobs.push(...verdict.jobs);
    }
  }

  stageFolderLook({ companyId: company.id, at: now, seen: listing.filter((f) => rowFileKind(f.relPath) !== null && include(f.relPath)).map((f) => f.relPath), changes });
  // Every file read this look misfits: the tool changed what it writes, and the source says so until it is mapped again.
  if (misfits > 0 && misfits === read) throw new FolderError('unmapped', `The files in this folder no longer fit its column mapping. ${MAP_AGAIN}`);
  return jobs;
}
