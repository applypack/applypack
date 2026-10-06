/**
 * What a look at a folder learned about its files, staged until the jobs of
 * that tick are stored (ADR 0062).
 *
 * The same shape as `conditional.ts`, for the same reason: a fetcher never
 * touches the database, and a ledger row that says "read" before its rows are
 * stored would leave them unseen — the file would never be read again. The
 * fetcher stages; `runFetchJob` hands the looks to the ledger only when
 * `tickStoredEverything()` agrees. A tick that did not store everything drops
 * them, and the next look reads the same files again: rows already stored are
 * duplicates, which cost nothing, and a saved posting's model reading is
 * remembered by its file's hash (fetchers/folder.ts), so it is not paid twice.
 */

import type { FileChange } from '../datasets/folder-scan';

export interface FolderLook {
  companyId: number;
  at: Date;
  /** Every file of the folder's kind the look listed: what "N files" counts. */
  seen: string[];
  changes: FileChange[];
}

const staged = new Map<number, FolderLook>();

export function stageFolderLook(look: FolderLook): void {
  staged.set(look.companyId, look);
}

/** The jobs are stored: the looks they came from, handed over once. */
export function takeFolderLooks(): FolderLook[] {
  const looks = [...staged.values()];
  staged.clear();
  return looks;
}

/** Start of a tick: a look whose tick never stored its jobs is dropped. */
export function beginFolderTick(): void {
  staged.clear();
}
