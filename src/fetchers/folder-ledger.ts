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
 *
 * "Everything" is asked a folder at a time (`looksToKeep`): a posting no
 * model would score, on any other source, failed every tick and so dropped
 * every folder's look every tick — each folder read its first twenty files
 * again each hour and never reached the twenty-first (#396).
 */

import type { FileChange } from '../datasets/folder-scan';

export interface FolderLook {
  companyId: number;
  at: Date;
  /** Every file of the folder's kind the look listed: what "N files" counts. */
  seen: string[];
  changes: FileChange[];
  /** The rules the tick judged this look's rows under (folder-scan.ts:rulesKey); null when nobody said. */
  rulesKey: string | null;
}

/** What the pipeline turned away of each folder file's rows in one tick, before any model read them (#448). */
export type TurnedAwayTally = Map<string, { rules: number; window: number; windowEndsAt: number | null }>;

const tallyKey = (companyId: number, relPath: string): string => `${companyId}/${relPath}`;

/**
 * One row of a folder's file turned away: by a search's filter or a mute,
 * or — with when it closes — by the re-apply window. The soonest window is
 * kept: the file is read again when it closes, and a later one is noted then.
 */
export function countTurnedAway(tally: TurnedAwayTally, companyId: number, relPath: string, windowEndsAt?: Date): void {
  const key = tallyKey(companyId, relPath);
  const counted = tally.get(key) ?? { rules: 0, window: 0, windowEndsAt: null };
  if (windowEndsAt === undefined) counted.rules++;
  else {
    counted.window++;
    counted.windowEndsAt = Math.min(counted.windowEndsAt ?? Number.POSITIVE_INFINITY, windowEndsAt.getTime());
  }
  tally.set(key, counted);
}

/**
 * The looks with what the pipeline turned away of each file added to what
 * the file carried from earlier looks: the ledger keeps it, and a look reads
 * the file again when the rules that turned rows away change (#448). A file
 * read before rows were counted stays uncounted until it is read whole.
 */
export function withTurnedAway(looks: readonly FolderLook[], tally: TurnedAwayTally): FolderLook[] {
  return looks.map((look) => ({
    ...look,
    changes: look.changes.map((change) => {
      const away = tally.get(tallyKey(look.companyId, change.relPath));
      if (!away) return change;
      return {
        ...change,
        turnedAway: change.turnedAway === null ? null : change.turnedAway + away.rules,
        windowTurnedAway: change.windowTurnedAway + away.window,
        windowEndsAt: away.windowEndsAt === null ? change.windowEndsAt : Math.min(change.windowEndsAt ?? Number.POSITIVE_INFINITY, away.windowEndsAt),
      };
    }),
  }));
}

/**
 * The looks a tick may keep. All of them when it stored everything it
 * fetched. None when it stopped before its end — a pause mid-run, no usable
 * search — because which postings were left then is not known source by
 * source. Otherwise the tick ran to its end and the only postings not stored
 * are those no verdict came for: a folder none of them came from has every
 * row of its look stored, and keeps it.
 */
export function looksToKeep(
  looks: readonly FolderLook[],
  stats: { abortedMidRun: number; skippedBlankProfile: number },
  unstored: ReadonlySet<number>,
): FolderLook[] {
  if (stats.abortedMidRun !== 0 || stats.skippedBlankProfile !== 0) return [];
  return looks.filter((look) => !unstored.has(look.companyId));
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
