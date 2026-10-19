import { AtsType, JobStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { addCounts, funnelView, readCounts, runCounts, sumDays, utcDay, type FunnelCounts, type FunnelView } from '../funnel';
import type { CronStats } from './cron-run';

/**
 * Where the search funnel (src/funnel.ts) is kept and read. The writers are
 * the fetch tick, the HN pull and the first scoring of what a paused fetch
 * stored; the last runs outside the fetch lock, so a day's row is read and
 * written under a lock of its own.
 */

const FUNNEL_LOCK_KEY = 0x41504b55; // "APKU" — the fetch lock's neighbour (fetch-lock.ts)

/** One run's counters into its day's row; a run that counted nothing (a skipped beat) writes nothing. */
export async function addToFunnel(startedAt: Date, stats: CronStats): Promise<void> {
  await addCountsToDay(startedAt, runCounts(stats));
}

/** Counters already shaped for the funnel (`funnel.ts:scorePassCounts`) into their day's row. */
export async function addCountsToDay(startedAt: Date, counts: FunnelCounts): Promise<void> {
  if (Object.keys(counts).length === 0) return;
  const day = utcDay(startedAt);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(${FUNNEL_LOCK_KEY}::bigint)`);
    const row = await tx.funnelDay.findUnique({ where: { day } });
    const next = addCounts(readCounts(row?.counts), counts);
    await tx.funnelDay.upsert({ where: { day }, create: { day, counts: next }, update: { counts: next } });
  });
}

const DAY_MS = 86_400_000;
/** The two windows the funnel is read over: /runs shows both, the Overview line the first. */
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;

/** The last 7 and 30 days, today included, out of the daily rows. */
export async function loadFunnel(now = new Date()): Promise<{ week: FunnelView; month: FunnelView }> {
  const since = utcDay(new Date(now.getTime() - (MONTH_DAYS - 1) * DAY_MS));
  const rows = await prisma.funnelDay.findMany({ where: { day: { gte: since } } });
  const days = rows.map((r) => ({ day: r.day, counts: readCounts(r.counts) }));
  return { week: funnelView(sumDays(days, WEEK_DAYS, now)), month: funnelView(sumDays(days, MONTH_DAYS, now)) };
}

export interface SourceYield {
  companyId: number;
  name: string;
  /** Postings the source brought that were new to this install. */
  stored: number;
  /** Of those, the ones a search kept after scoring. */
  matches: number;
}

/**
 * What each source brought in the last 30 days, off the jobs themselves:
 * stored, and kept as a match (scored, not dismissed). The window is the
 * cleanup's: a dismissed job older than that is deleted, so a longer one
 * would undercount. A pasted posting is not a source's (its MANUAL row).
 */
export async function loadSourceYield(now = new Date()): Promise<SourceYield[]> {
  const where = {
    fetchedAt: { gte: new Date(now.getTime() - MONTH_DAYS * DAY_MS) },
    company: { atsType: { not: AtsType.MANUAL } },
  };
  const [stored, matched] = await Promise.all([
    prisma.job.groupBy({ by: ['companyId'], where, _count: { _all: true } }),
    prisma.job.groupBy({
      by: ['companyId'],
      where: { ...where, status: { not: JobStatus.DISMISSED }, fitScore: { not: null } },
      _count: { _all: true },
    }),
  ]);
  if (stored.length === 0) return [];
  const names = await prisma.company.findMany({
    where: { id: { in: stored.map((s) => s.companyId) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((c) => [c.id, c.name]));
  const matchesOf = new Map(matched.map((m) => [m.companyId, m._count._all]));
  return stored
    .map((s) => ({ companyId: s.companyId, name: nameOf.get(s.companyId) ?? `#${s.companyId}`, stored: s._count._all, matches: matchesOf.get(s.companyId) ?? 0 }))
    .sort((a, b) => b.matches - a.matches || b.stored - a.stored || a.name.localeCompare(b.name));
}
