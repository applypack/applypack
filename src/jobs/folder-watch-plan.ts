/*
 * Which folders the worker watches for a newly saved posting (ADR 0062), and
 * how long it lets a burst of changes settle. Pure — tested in
 * folder-watch-plan.test.ts; the watchers themselves are folder-watch.ts.
 */

import { SETTLE_MS } from '../datasets/folder-scan';

/** A change is acted on this long after the last one: a browser writes a page, then its folder of images, then renames. */
export const WATCH_SETTLE_MS = SETTLE_MS + 2_000;
/** How often the list of watched folders is read again: a folder switched on is watched within this. */
export const WATCH_REFRESH_MS = 60_000;
/** A check that met another fetch holding the lock tries again this much later. */
export const WATCH_RETRY_MS = 60_000;

export interface WatchChanges {
  start: { id: number; path: string }[];
  stop: number[];
}

/**
 * What to change so the watchers match the sources: a source switched on or
 * added is started, one switched off or deleted is stopped, and one whose
 * folder moved is stopped and started on its new path.
 */
export function watchChanges(wanted: ReadonlyMap<number, string>, current: ReadonlyMap<number, string>): WatchChanges {
  const start: WatchChanges['start'] = [];
  const stop: number[] = [];
  for (const [id, path] of current) if (wanted.get(id) !== path) stop.push(id);
  for (const [id, path] of wanted) if (current.get(id) !== path) start.push({ id, path });
  return { start, stop };
}
