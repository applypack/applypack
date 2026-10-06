import type { FolderFault } from '../datasets/folder-io';
import { postingFileKind } from '../datasets/folder-scan';
import type { CronStats } from '../jobs/cron-run';
import type { FolderSummary } from '../jobs/source-file-store';
import type { FlashKind } from './flash';
import { t } from '../i18n/t';

/*
 * A folder source in words (ADR 0062): its line on Companies, a file's line
 * on the per-file list, and what to do when the system will not let the
 * folder be read. Pure — tested in folder-words.test.ts.
 */

/** "214 files · 3 new at the last check · 1 waiting" — what a folder's row says about its files. */
export function folderLine(summary: FolderSummary | undefined): string {
  if (!summary || summary.lastLookAt === null) return t('folders.line.notChecked');
  const parts = [t('folders.line.files', { files: summary.files, fresh: summary.fresh })];
  if (summary.waiting > 0) parts.push(t('folders.line.waiting', { n: summary.waiting }));
  if (summary.failed > 0) parts.push(t('folders.line.failed', { n: summary.failed }));
  return parts.join(' · ');
}

export interface FileLine {
  /** One or two words for the badge. */
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  /** The sentence beside it. */
  text: string;
}

/**
 * What became of one file, for the per-file list. `present` is false for a
 * file the last look did not list: moved, deleted, or left out by a name
 * filter set since. Its jobs are the user's record and stay either way.
 */
export function fileLine(file: { status: string; detail: string | null; jobCount: number; kind: string }, present: boolean): FileLine {
  // A saved posting is one job, and its note already says which (datasets/posting-file.ts:savedPostingNote).
  const posting = postingFileKind(`file.${file.kind}`) !== null;
  const gone = present ? null : t('folders.file.gone', { jobs: file.jobCount === 0 ? 'none' : posting ? 'posting' : 'rows' });
  const say = (...sentences: (string | null)[]): string => sentences.filter((s) => s).join(' ');
  if (file.status === 'done') {
    if (posting) return { label: t('folders.file.read'), tone: 'ok', text: say(file.detail ?? t('folders.file.readAsPosting'), gone) };
    return { label: t('folders.file.read'), tone: 'ok', text: say(t('folders.file.rowsRead', { n: file.jobCount }), file.detail, gone) };
  }
  if (file.status === 'waiting') return { label: t('folders.file.waiting'), tone: 'neutral', text: say(file.detail ?? t('folders.file.nextCheckReads'), gone) };
  if (file.status === 'failed') return { label: t('folders.file.notRead'), tone: 'danger', text: say(file.detail ?? t('folders.file.couldNotRead'), gone) };
  return { label: t('folders.file.setAside'), tone: 'warn', text: say(file.detail ?? t(posting ? 'folders.file.notAPosting' : 'folders.file.notRows'), gone) };
}

/**
 * Why a folder cannot be looked at, with the way out. A refused read on a
 * Mac is usually the system's privacy guard over Desktop, Documents and
 * Downloads, which no path rule of ours can lift.
 */
export function explainFolderFault(fault: FolderFault, message: string, platform: NodeJS.Platform, server: boolean): string {
  if (fault === 'refused') {
    if (server) return `${message} ${t('folders.fault.refusedServer')}`;
    if (platform === 'darwin') return `${message} ${t('folders.fault.refusedMac')}`;
    return `${message} ${t('folders.fault.refused')}`;
  }
  if (fault === 'missing' && server) return `${message} ${t('folders.fault.missingServer')}`;
  return message;
}

/**
 * "Check now" on a folder that brought no rows, as its own sentence: the
 * shared summary (fetch-summary.ts) would say to check the network, and no
 * request was made. Null when rows came, or when the run did not get as far
 * as the folder — the shared summary speaks for those.
 */
export function folderCheckLine(label: string, stats: CronStats): { kind: FlashKind; text: string } | null {
  const source = Array.isArray(stats.bySource) ? stats.bySource[0] : undefined;
  if (!source || typeof stats.reason === 'string' || (typeof stats.fetched === 'number' && stats.fetched > 0)) return null;
  if (source.status === 'empty') return { kind: 'ok', text: t('runs.folderCheck.nothingNew', { label }) };
  return { kind: 'err', text: t('folders.check.notRead', { label, status: source.status }) };
}
