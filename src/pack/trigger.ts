import type { PackSettings } from './settings';

/*
 * Whether the tick queues a pack for a posting it has just stored. Pure.
 *
 * It is asked only at that moment, about that posting — which is what keeps
 * the backlog out: nothing stored before the feature was switched on is ever
 * walked, and re-classifying every job against a new search queues nothing.
 * A person can still ask for any posting by hand; none of this applies then.
 */

export type AutoPack = 'queue' | 'off' | 'low-fit' | 'old' | 'limit';

const DAY_MS = 24 * 60 * 60 * 1000;

export function autoPack(input: {
  settings: PackSettings;
  /** The classifier's fit for the search that scored the posting best. */
  fit: number | null;
  postedAt: Date;
  now: Date;
  /** Packs the worker has queued on its own since the UTC day began. */
  queuedToday: number;
}): AutoPack {
  const { settings } = input;
  if (!settings.enabled) return 'off';
  if (input.fit === null || input.fit < settings.minFit) return 'low-fit';
  // A first fetch brings postings that have been up for weeks; those are the
  // ones an application is least likely to still matter for.
  if (input.now.getTime() - input.postedAt.getTime() > settings.maxAgeDays * DAY_MS) return 'old';
  if (settings.dailyLimit > 0 && input.queuedToday >= settings.dailyLimit) return 'limit';
  return 'queue';
}

/** Midnight UTC of `now` — the day the limit counts, as the search funnel counts its days. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
