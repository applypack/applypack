/*
 * A posting's age, said where the fit is read (#770). A regular-level,
 * part-time posting published five months earlier stood in the list as
 * "88 Strong": the fit says the role suits the search, and nothing said the
 * role had been up since June. Pure.
 */

/** Past this many days a posting is old enough to check before any work goes into it. */
export const OLD_POSTING_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many whole days ago the source says it published the posting, when that
 * is `OLD_POSTING_DAYS` or more; null for a recent one, and for one whose
 * source gave no date — "first seen" is our clock, not the posting's.
 */
export function oldPostingDays(job: { postedAt: Date; postedAtKnown: boolean }, now: Date = new Date()): number | null {
  if (!job.postedAtKnown) return null;
  const days = Math.floor((now.getTime() - job.postedAt.getTime()) / DAY_MS);
  return days >= OLD_POSTING_DAYS ? days : null;
}
