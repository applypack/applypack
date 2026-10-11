/*
 * Dates off a feed or a vendor API. `new Date(garbage)` is an Invalid Date,
 * and one of those in `postedAt` used to throw in the classifier's prompt
 * line, keep the row unstored (so it came back every tick) and make the
 * tick discard its whole ETag cache (audit 2026-09-10, FETCH-1). The
 * fetchers read through safeDate; process-jobs checks once more on the
 * way in, so a fetcher that forgets cannot repeat it.
 */

/** The date a feed or API gave, or `fallback` (now) when it does not parse. */
export function safeDate(raw: string | number | null | undefined, fallback = new Date()): Date {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** A Date that is one; an invalid one becomes `fallback`. */
export function validDate(d: Date, fallback = new Date()): Date {
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/**
 * Whether a posting's date is the clock's and not its source's (#379). Every
 * mapper writes now when a feed gives no date or one that does not parse —
 * `safeDate` above, and thirty lines like it — and three vendors publish none
 * at all. A date the source gave lies before the moment its read began; one
 * at or after it was written here, while the answer was being mapped. A
 * source whose own clock runs ahead of ours is read the same way: its date
 * says nothing we can hold it to.
 */
export function clockDated(postedAt: Date, readBegan: number): boolean {
  return postedAt.getTime() >= readBegan;
}

/** Mark what one read brought whose date is the clock's. A mapper that knows already (the row mapper) has said so, and is not unsaid. */
export function markClockDated<T extends { postedAt: Date; undated?: boolean }>(jobs: readonly T[], readBegan: number): void {
  for (const job of jobs) {
    if (clockDated(job.postedAt, readBegan)) job.undated = true;
  }
}
