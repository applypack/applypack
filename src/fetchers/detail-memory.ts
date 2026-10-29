import { sleep } from '../http';
import { logger } from '../logger';

/*
 * The per-posting detail reads of a vendor whose list carries no posting
 * text (Rippling, BambooHR — #658). Two rules:
 *
 * 1. **A posting goes out only once its text was read.** The tick dedupes on
 *    (companyId, externalId) and never reads a stored row again, so a row
 *    returned title-only past the cap was a stub for ever: 589 of Rippling's
 *    own 649 rows were stored as "Department: X." with the clock's date.
 *    A posting whose detail was not read waits for a later read instead.
 * 2. **A detail is read once per process, not once per tick.** What was read
 *    is kept here, pruned to what the board still lists, so a board longer
 *    than the cap is read over a few ticks and then costs only its new
 *    postings — where every tick used to spend the cap on the same rows.
 *
 * The memory holds the text a fetcher needs, never the raw answer.
 */

/** What one read of a board's details came to. */
export interface DetailRead<T> {
  /** Every listed id whose detail is known, remembered or read now. */
  details: Map<string, T>;
  /** Listed ids still without a detail — past the cap, or their request failed. */
  waiting: number;
  /** Detail requests this read made. */
  requested: number;
}

/** Which listed ids to ask about now: the ones not remembered, in list order, up to the cap. Pure. */
export function planDetails(ids: readonly string[], remembered: { has(id: string): boolean }, cap: number): string[] {
  return ids.filter((id) => !remembered.has(id)).slice(0, Math.max(0, cap));
}

/**
 * Read what `memory` does not hold yet, `cap` at most, one at a time with a
 * pause between them. `readOne` answers null for a reply that is not a
 * detail. When every request of the read failed, the read fails — with the
 * last error, or one saying no answer had the shape: a board whose detail
 * endpoint stopped answering must read as failing, not as empty (gotcha 13).
 */
export async function readDetails<T>(
  memory: Map<string, T>,
  ids: readonly string[],
  readOne: (id: string) => Promise<T | null>,
  opts: { cap: number; delayMs: number; source: string },
): Promise<DetailRead<T>> {
  const listed = new Set(ids);
  for (const id of memory.keys()) if (!listed.has(id)) memory.delete(id);
  const toRead = planDetails([...listed], memory, opts.cap);
  let failed = 0;
  let lastError: unknown = null;
  for (const [i, id] of toRead.entries()) {
    if (i > 0) await sleep(opts.delayMs);
    try {
      const detail = await readOne(id);
      if (detail === null) {
        failed++;
        logger.warn({ source: opts.source, id }, 'detail answer was not a posting');
      } else {
        memory.set(id, detail);
      }
    } catch (err) {
      failed++;
      lastError = err;
      logger.warn({ err, source: opts.source, id }, 'detail read failed');
    }
  }
  if (toRead.length > 0 && failed === toRead.length) {
    throw lastError ?? new Error(`${opts.source}: no detail answer had the expected shape (${failed} asked)`);
  }
  const details = new Map<string, T>();
  for (const id of listed) {
    const detail = memory.get(id);
    if (detail !== undefined) details.set(id, detail);
  }
  return { details, waiting: listed.size - details.size, requested: toRead.length };
}
