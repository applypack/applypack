import type { FolderFault } from '../datasets/folder-io';
import { postingFileKind } from '../datasets/folder-scan';
import { describeStatus } from '../fetchers/source-health';
import type { CronStats } from '../jobs/cron-run';
import type { FolderSummary } from '../jobs/source-file-store';
import type { FlashKind } from './flash';

/*
 * A folder source in words (ADR 0062): its line on Companies, a file's line
 * on the per-file list, and what to do when the system will not let the
 * folder be read. Pure — tested in folder-words.test.ts.
 */

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "214 files · 3 new at the last check · 1 waiting" — what a folder's row says about its files. */
export function folderLine(summary: FolderSummary | undefined): string {
  if (!summary || summary.lastLookAt === null) return 'Not checked yet.';
  const parts = [`${count(summary.files, 'file')} · ${summary.fresh} new at the last check`];
  if (summary.waiting > 0) parts.push(`${summary.waiting} waiting`);
  if (summary.failed > 0) parts.push(`${summary.failed} not read`);
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
  const gone = present ? '' : ` The last check did not find it among the folder’s files${file.jobCount > 0 ? (posting ? '; its job stays' : '; its jobs stay') : ''}.`;
  if (file.status === 'done') {
    if (posting) return { label: 'Read', tone: 'ok', text: `${file.detail ?? 'Read as a posting.'}${gone}` };
    return { label: 'Read', tone: 'ok', text: `${count(file.jobCount, 'row')} read as ${file.jobCount === 1 ? 'a job' : 'jobs'}.${file.detail ? ` ${file.detail}` : ''}${gone}` };
  }
  if (file.status === 'waiting') return { label: 'Waiting', tone: 'neutral', text: `${file.detail ?? 'The next check reads it.'}${gone}` };
  if (file.status === 'failed') return { label: 'Not read', tone: 'danger', text: `${file.detail ?? 'It could not be read.'}${gone}` };
  return { label: 'Set aside', tone: 'warn', text: `${file.detail ?? (posting ? 'Not read as a posting.' : 'Not a file of rows.')}${gone}` };
}

/**
 * Why a folder cannot be looked at, with the way out. A refused read on a
 * Mac is usually the system's privacy guard over Desktop, Documents and
 * Downloads, which no path rule of ours can lift.
 */
export function explainFolderFault(fault: FolderFault, message: string, platform: NodeJS.Platform, server: boolean): string {
  if (fault === 'refused') {
    if (server) return `${message} Check that the user ApplyPack runs as may read it; in Docker, mount the folder into both services read-only (docker-compose.yml).`;
    if (platform === 'darwin') {
      return `${message} macOS guards Desktop, Documents and Downloads: allow the program ApplyPack was started from under System Settings → Privacy & Security → Files and Folders, or use a folder directly in your home folder, such as ~/ApplyPack/inbox, which needs no permission.`;
    }
    return `${message} Check that the user ApplyPack runs as may read the folder.`;
  }
  if (fault === 'missing' && server) return `${message} In Docker the path is the one inside the container: the right-hand side of the mount.`;
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
  if (source.status === 'empty') return { kind: 'ok', text: `${label}: nothing new in the folder. A file is read once, and again when it changes.` };
  return {
    kind: 'err',
    text: `${label}: the folder was not read — ${describeStatus(source.status, 'FOLDER').label.toLowerCase()}. Nothing stored is touched; Files on its row says what happened to each file, and Mapping checks the folder again.`,
  };
}
