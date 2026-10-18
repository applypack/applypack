import type { PackSettings } from './settings';
import type { NormalizedJob } from '../types';
import { sourceFamily } from '../web/source-groups';

/*
 * Whether the tick queues a pack for a posting it has just stored. Pure.
 *
 * It is asked only at that moment, about that posting — which is what keeps
 * the backlog out: nothing stored before the feature was switched on is ever
 * walked, and re-classifying every job against a new search queues nothing.
 * A person can still ask for any posting by hand; none of this applies then.
 */

export type AutoPack = 'queue' | 'off' | 'low-fit' | 'undated' | 'old' | 'limit';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The moment a new posting's age is counted from, or null when nothing shows
 * it. The date its source gave, first. With none (#379), a company's own
 * board still tells (#459): it lists every role it has open, so a posting
 * new to us since its previous read went up after that read. An aggregator's
 * window can bring an old posting back, a feed may be such a window, a file
 * of rows says nothing of when it was put together, and a board's first read
 * has no read before it.
 */
export function ageCountsFrom(job: Pick<NormalizedJob, 'postedAt' | 'undated' | 'previousRead'>, atsType: string | null): Date | null {
  if (job.undated !== true) return job.postedAt;
  return atsType !== null && sourceFamily(atsType) === 'vendor' ? (job.previousRead ?? null) : null;
}

export function autoPack(input: {
  settings: PackSettings;
  /** The classifier's fit for the search that scored the posting best. */
  fit: number | null;
  /** `ageCountsFrom`: when the posting's age starts, null when nothing shows it. */
  countsFrom: Date | null;
  now: Date;
  /** Packs the worker has queued on its own since the UTC day began. */
  queuedToday: number;
}): AutoPack {
  const { settings } = input;
  if (!settings.enabled) return 'off';
  if (input.fit === null || input.fit < settings.minFit) return 'low-fit';
  // "Published recently" is what keeps the backlog out, and a date nobody
  // gave would let it all in: a file of last month's postings, or every role
  // on a board that has just been added, would each read as published today.
  if (input.countsFrom === null) return 'undated';
  // A first fetch brings postings that have been up for weeks; those are the
  // ones an application is least likely to still matter for.
  if (input.now.getTime() - input.countsFrom.getTime() > settings.maxAgeDays * DAY_MS) return 'old';
  if (settings.dailyLimit > 0 && input.queuedToday >= settings.dailyLimit) return 'limit';
  return 'queue';
}

/**
 * What is stored of a role a new posting is another source's copy of
 * (`Job.crossListedOfJobId`, ADR 0018): whether any of its postings has a
 * pack, and when the first of them was stored.
 */
export interface SameRole {
  hasPack: boolean;
  firstStoredAt: Date;
}

export type CopyPack = 'queue' | 'has-pack' | 'before-packs';

/**
 * Whether a posting that would get a pack still gets one when it is a copy
 * of a role already stored (#380). One role is prepared once: each copy ran
 * its own comparison and its own company check, and the morning message
 * listed the role twice. And a copy is not a door into the backlog: a role
 * stored before packs were switched on stays unprepared, as the settings
 * promise — with no record of that moment, nothing shows the role came
 * after it. Asked of automatic packs only.
 */
export function copyPack(input: { role: SameRole; onSince: Date | null }): CopyPack {
  if (input.role.hasPack) return 'has-pack';
  if (input.onSince === null || input.role.firstStoredAt.getTime() < input.onSince.getTime()) return 'before-packs';
  return 'queue';
}

export type Unwanted = 'off' | 'dismissed' | 'applied' | 'muted';

/**
 * Whether a pack the tick queued is no longer wanted when the runner takes
 * it. The queue can lag by hours — a pack is minutes of AI, the oldest first
 * — and meanwhile the person may have switched packs off, dismissed the job,
 * applied another way or muted the company. Asked of automatic packs only:
 * one asked for by hand is prepared whatever became of the job.
 */
export function autoPackUnwanted(input: { enabled: boolean; status: string; applied: boolean; muted: boolean }): Unwanted | null {
  if (!input.enabled) return 'off';
  if (input.status === 'DISMISSED') return 'dismissed';
  if (input.applied) return 'applied';
  return input.muted ? 'muted' : null;
}

/** Midnight UTC of `now` — the day the limit counts, as the search funnel counts its days. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
