import { inRunLocale } from '../run-locale';
import { getSettings } from '../settings';
import { recordCronRun } from './cron-run';
import { runFetchJob } from './fetch-job';
import { tryFetchLock, waitForFetchLock } from './fetch-lock';

/*
 * The two ways the worker starts a fetch by itself — the hourly tick and the
 * look at a folder something was just saved into — and what each does when
 * another fetch holds the lock (#397). Both ask for the lock BEFORE a run is
 * recorded, so meeting another fetch leaves no row on /runs: a folder check
 * that asked every minute through a twenty-minute tick left twenty.
 * Kept apart from index.ts, which starts the worker when it is loaded.
 */

/** How often a tick that met another fetch asks for the lock again. */
const LOCK_RETRY_MS = 60_000;
/** How long it goes on asking: given up before the next hour's tick is due, which asks for itself. */
const TICK_LOCK_WAIT_MS = 50 * 60_000;

export interface TickOptions {
  everyMs?: number;
  waitMs?: number;
  /** True once the worker is shutting down. */
  stopping?: () => boolean;
}

/**
 * The hourly tick. It used to ask for the lock once, so an import scoring
 * its rows or a look at a folder of saved postings cost the hour its search,
 * its held alerts and its licence re-check. It now waits for whoever holds
 * the lock and runs when they are done. An hour in which the lock never came
 * free is one row saying so.
 */
export async function fetchTick(opts: TickOptions = {}): Promise<void> {
  const lock = await waitForFetchLock({ everyMs: opts.everyMs ?? LOCK_RETRY_MS, waitMs: opts.waitMs ?? TICK_LOCK_WAIT_MS, stopping: opts.stopping });
  if (lock === null) {
    if (opts.stopping?.()) return;
    await recordCronRun('fetch', async () => ({ stats: { skipped: 1, reason: 'overlap' } }));
    return;
  }
  await recordCronRun('fetch', () => runFetchJob({ lock }));
}

/**
 * One folder source looked at now, because something in it changed: the
 * fetch scoped to that row, under the same lock as the tick. Never while
 * fetching is paused — a saved posting waits for the pipeline as every source
 * does — and outside the search hours too, since the user has just saved it.
 * `busy` when another fetch holds the lock: the watcher asks again later.
 */
export async function checkFolder(companyId: number, opts: Pick<TickOptions, 'stopping'> = {}): Promise<'done' | 'busy'> {
  if (opts.stopping?.() || !(await getSettings()).fetchingEnabled) return 'done';
  const lock = await tryFetchLock();
  if (lock === null) return 'busy';
  // Its matches are alerted as the tick's are: in the interface's language.
  await inRunLocale(() => recordCronRun('folder-watch', () => runFetchJob({ manual: true, only: (c) => c.id === companyId, lock })));
  return 'done';
}
