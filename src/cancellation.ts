/**
 * Wraps an async boolean probe (e.g. "is fetching paused?") so long loops
 * can poll it every iteration without hammering the source: the underlying
 * read runs at most once per `minIntervalMs`, and once it answers true the
 * probe latches — later calls return true without reading again. A latched
 * run stays aborted even if the flag flips back mid-run; the next cron tick
 * picks the new value up.
 */
export function makeLatchingProbe(
  read: () => Promise<boolean>,
  minIntervalMs: number,
  now: () => number = Date.now,
): () => Promise<boolean> {
  let latched = false;
  let lastReadAt: number | null = null;

  return async () => {
    if (latched) return true;
    const t = now();
    if (lastReadAt !== null && t - lastReadAt < minIntervalMs) return false;
    lastReadAt = t;
    if (await read()) latched = true;
    return latched;
  };
}
