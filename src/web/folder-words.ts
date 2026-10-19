import type { FolderFault } from '../datasets/folder-io';
import { describeStatus } from '../fetchers/source-health';
import { postingFileKind } from '../datasets/folder-scan';
import type { CronStats } from '../jobs/cron-run';
import type { FolderSummary } from '../jobs/source-file-store';
import type { FlashKind } from './flash';
import { healthLabel } from './health-label';
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
  if (summary.partial > 0) parts.push(t('folders.line.partial', { n: summary.partial }));
  return parts.join(' · ');
}

/**
 * "1 set aside": the files the last check left unread — a copy, one too
 * large, JSON cut short, a quote never closed — apart from the line above,
 * so the card can link them to the per-file list, which says why (#478).
 * Null when there are none.
 */
export function setAsideLine(summary: FolderSummary | undefined): string | null {
  return summary && summary.lastLookAt !== null && summary.skipped > 0 ? t('folders.line.setAside', { n: summary.skipped }) : null;
}

/**
 * A folder whose last check failed, in the folder's words, for its card: the
 * line above is built from the ledger and says only what earlier checks read,
 * so a folder renamed away looked healthy there (#405). Null while the source
 * is healthy or was never checked.
 */
export function folderTrouble(status: string | null, streak: number): { label: string; tone: 'danger' | 'warn'; title: string } | null {
  const { tone } = describeStatus(status, 'FOLDER');
  if (tone !== 'bad' && tone !== 'warn') return null;
  const label = healthLabel(status, 'FOLDER');
  return { label, tone: tone === 'bad' ? 'danger' : 'warn', title: streak > 0 ? t('sources.health.withStreak', { label, n: streak }) : label };
}

/** What a saved posting with no title of its own is called: a saved page has a title to state, a text file, a PDF or a document has none to look for. */
export function untitledLine(relPath: string): string {
  const kind = postingFileKind(relPath);
  return t(kind === 'html' || kind === 'mhtml' || kind === 'webarchive' ? 'folders.postings.noTitle' : 'folders.postings.noTitleFile');
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
    // A file of rows carries a note only for what of it could not be read (datasets/read-notes.ts).
    if (file.detail) return { label: t('folders.file.readInPart'), tone: 'warn', text: say(t('folders.file.rowsRead', { n: file.jobCount }), file.detail, gone) };
    return { label: t('folders.file.read'), tone: 'ok', text: say(t('folders.file.rowsRead', { n: file.jobCount }), gone) };
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
