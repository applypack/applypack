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
