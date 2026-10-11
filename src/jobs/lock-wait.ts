/*
 * Waiting for a lock somebody else holds (#397). The hourly tick used to ask
 * for the fetch lock once: an import scoring its rows, or a look at a folder
 * of saved postings, held it at that moment and the hour had no search, no
 * held alert delivered and no licence re-check, though the lock was free
 * again seconds later. A tick now asks again until it is.
 * The lock and the clock are handed in — tested in lock-wait.test.ts.
 */

export interface LockWait {
  /** How long to go on asking; the first ask is always made. */
  waitMs: number;
  /** How long between asks. */
  everyMs: number;
  /** True once the process is on its way out: the wait ends, with nothing. */
  stopping?: () => boolean;
}

interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const CLOCK: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
/** A wait is slept through a second at a time, so a shutdown is not kept waiting for a whole interval. */
const SLICE_MS = 1_000;

/**
 * The lock, asked for again every `everyMs` until it is free. Null when it
 * was not free within `waitMs` — no ask is started past that — or when the
 * process is stopping.
 */
export async function waitForLock<T>(tryLock: () => Promise<T | null>, wait: LockWait, clock: Clock = CLOCK): Promise<T | null> {
  const until = clock.now() + wait.waitMs;
  for (;;) {
    if (wait.stopping?.()) return null;
    const lock = await tryLock();
    if (lock !== null) return lock;
    if (clock.now() + wait.everyMs > until) return null;
    for (let slept = 0; slept < wait.everyMs; slept += SLICE_MS) {
      if (wait.stopping?.()) return null;
      await clock.sleep(Math.min(SLICE_MS, wait.everyMs - slept));
    }
  }
}
