/*
 * A press that starts work is refused while the same work is still running
 * in this process: the double-clicked submit and the two-tab paste both land
 * within a second, and each used to spend a second AI call or mint a second
 * row (audit 2026-09-10, ROUTE-1). Keys are the caller's; a key older than
 * the ceiling is treated as finished, so a crash inside the work cannot hold
 * the button forever.
 */

const running = new Map<string, number>();
export const INFLIGHT_TTL_MS = 10 * 60_000;

/** Claim the key; false when it is already held and not yet expired. */
export function beginOnce(key: string, now = Date.now()): boolean {
  const since = running.get(key);
  if (since !== undefined && now - since < INFLIGHT_TTL_MS) return false;
  running.set(key, now);
  return true;
}

export function endOnce(key: string): void {
  running.delete(key);
}

/** Run `work` once per key; the second caller gets `busy` back instead. */
export async function once<T>(key: string, work: () => Promise<T>, busy: () => T): Promise<T> {
  if (!beginOnce(key)) return busy();
  try {
    return await work();
  } finally {
    endOnce(key);
  }
}
