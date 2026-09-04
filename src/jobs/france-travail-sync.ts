import { AtsType, JobStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { sleep } from '../http';
import { logger } from '../logger';
import { CALL_GAP_MS, credentialsFrom, licenceLine, mapFranceTravailOffer, offerStillListed } from '../fetchers/francetravail';
import { redactSecrets } from '../source-keys';
import type { FetchContext } from '../fetchers/fetch-context';

/*
 * The licence's freshness rule as code (ADR 0034; licence art. 5.2 and 7):
 * an offer must be re-checked at least every 24 hours, and what the board
 * deleted or changed is deleted or changed here.
 *
 * The mirror therefore has two phases, and the second one needs neither a
 * credential nor a reachable board:
 *
 *   1. Ask. Every stored offer whose last successful check is older than a
 *      day goes to the detail resource — 200 keeps it (and refreshes it
 *      when the board changed it), 204 withdraws it.
 *   2. Expire. An offer nobody could vouch for within LICENCE_MAX_AGE_MS is
 *      withdrawn from us anyway. The licence asks for a daily re-check; when
 *      the key is gone, the board is down or the container was off, the
 *      honest answer is to stop holding content we can no longer verify —
 *      not to keep showing it and hope.
 *
 * A withdrawn offer is deleted, unless it is the user's own record (applied,
 * saved, or moved on the board), in which case it stays with its content
 * anonymised as art. 7 lists: employer, contact, description, offer URL,
 * commune.
 *
 * Two things the mirror deliberately ignores. It does not read
 * `Company.active`: switching a France Travail row off stops new offers, it
 * does not release us from the ones already stored. And it is not gated by
 * the fetching pause — see jobs/fetch-job.ts, where it runs above every
 * gate.
 */

/** Checks per tick — at one every CALL_GAP_MS that is under a minute of calls. */
export const MAX_CHECKS_PER_TICK = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long an offer may go unverified before we withdraw it ourselves. The
 * licence's window is a day; the mirror tries every hour, so reaching two
 * days means ~24 consecutive attempts found no key or no board — an outage,
 * not a blip. The margin is grace, never permission: it must stay larger
 * than the due window, or an offer would expire before anyone asked about it.
 */
export const LICENCE_MAX_AGE_MS = 2 * DAY_MS;
/** Ids per DELETE — Postgres takes 65 535 bind parameters, and one statement should not court the limit. */
const DELETE_BATCH = 1_000;

export interface StoredOffer {
  id: number;
  externalId: string;
  status: JobStatus;
  pipelineStage: string | null;
}

export type SyncPlan = { action: 'delete' | 'anonymise' | 'keep'; id: number }[];

/** What one tick did. `expired` counts the rows in `deleted`/`anonymised` that phase 2 withdrew. */
export interface MirrorStats {
  checked: number;
  deleted: number;
  anonymised: number;
  expired: number;
}

/** What to do with each stored offer once the board has answered for it. */
export function planSync(stored: readonly StoredOffer[], gone: ReadonlySet<string>): SyncPlan {
  return stored.map((job) => {
    if (!gone.has(job.externalId)) return { action: 'keep', id: job.id };
    // The same line the cleanup job draws: an application's history is the
    // user's, never garbage-collected — so it is anonymised, not deleted.
    const own = job.pipelineStage !== null || job.status === JobStatus.APPLIED || job.status === JobStatus.SAVED;
    return { action: own ? 'anonymise' : 'delete', id: job.id };
  });
}

/** Phase 2's plan: every one of these is withdrawn — the deadline decided, not the board. */
export function planExpiry(stored: readonly StoredOffer[]): SyncPlan {
  return planSync(stored, new Set(stored.map((job) => job.externalId)));
}

/** The columns a withdrawn offer keeps nothing identifying in (licence art. 7). */
export function anonymisedOffer(now: Date): Prisma.JobUpdateInput {
  return {
    description: `This offer was withdrawn from France Travail on ${now.toISOString().slice(0, 10)}. Its content was removed as the board's licence requires; your own notes and application record are kept.`,
    location: 'France',
    countries: ['FR'],
    regions: [],
    url: 'https://www.francetravail.fr/',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    sourcePayload: Prisma.JsonNull,
    sourceUpdatedAt: null,
    sourceCheckedAt: now,
  };
}

/** Which stored offers are due: last checked more than a day ago. */
export function dueBefore(now: Date): Date {
  return new Date(now.getTime() - DAY_MS);
}

/** Past this instant an offer has gone unverified longer than the licence allows. */
export function expiredBefore(now: Date): Date {
  return new Date(now.getTime() - LICENCE_MAX_AGE_MS);
}

/**
 * Rows last vouched for before `before`. A row that was never checked is
 * judged by when it arrived: it was current the moment it was fetched, so a
 * fresh offer is neither due nor expired.
 */
export function unverifiedSince(before: Date): Prisma.JobWhereInput {
  return { OR: [{ sourceCheckedAt: { lt: before } }, { sourceCheckedAt: null, fetchedAt: { lt: before } }] };
}

const OFFER_COLUMNS = { id: true, externalId: true, status: true, pipelineStage: true } as const;

/**
 * The daily mirror. Runs on every tick and does the work that is due, so a
 * missed hour never becomes a missed day. It holds no opinion about whether
 * fetching is paused: this is the licence's obligation, not a search.
 */
export async function syncFranceTravail(context: FetchContext): Promise<MirrorStats> {
  const result: MirrorStats = { checked: 0, deleted: 0, anonymised: 0, expired: 0 };
  const rows = await prisma.company.findMany({ where: { atsType: AtsType.FRANCETRAVAIL }, select: { id: true } });
  if (rows.length === 0) return result;
  const companyId = { in: rows.map((r) => r.id) };
  const now = context.now ?? new Date();

  // Phase 1 — ask the board about everything that is due, while we can.
  const creds = credentials(context);
  if (creds) {
    const due = await prisma.job.findMany({
      where: { companyId, ...unverifiedSince(dueBefore(now)) },
      select: { ...OFFER_COLUMNS, companyId: true, sourceUpdatedAt: true },
      orderBy: { sourceCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: MAX_CHECKS_PER_TICK,
    });
    const gone = new Set<string>();
    for (const job of due) {
      try {
        const { listed, offer } = await offerStillListed(job.externalId, creds);
        result.checked++;
        if (!listed) {
          gone.add(job.externalId);
          continue;
        }
        // Still listed: note the check, and take the board's newer version when it changed (art. 5.2).
        const fresh = offer ? mapFranceTravailOffer(offer, job.companyId) : null;
        const changed = fresh?.sourceUpdatedAt && (!job.sourceUpdatedAt || fresh.sourceUpdatedAt.getTime() !== job.sourceUpdatedAt.getTime());
        await prisma.job.update({
          where: { id: job.id },
          data: {
            sourceCheckedAt: now,
            ...(changed && fresh
              ? { title: fresh.title, description: fresh.description, location: fresh.location, url: fresh.url, sourcePayload: fresh.sourcePayload as Prisma.InputJsonValue, sourceUpdatedAt: fresh.sourceUpdatedAt }
              : {}),
          },
        });
      } catch (err) {
        logger.warn({ err: redactSecrets(err instanceof Error ? err.message : String(err), [creds.client_secret]), jobId: job.id }, 'france-travail-sync: check failed');
      }
      await sleep(CALL_GAP_MS);
    }
    await apply(planSync(due, gone), now, result);
  }

  // Phase 2 — what phase 1 could not vouch for in time leaves anyway. Runs
  // after phase 1's writes, so a row it just refreshed is no longer stale.
  const stale = await prisma.job.findMany({
    where: { companyId, ...unverifiedSince(expiredBefore(now)) },
    select: OFFER_COLUMNS,
  });
  const before = result.deleted + result.anonymised;
  await apply(planExpiry(stale), now, result);
  result.expired = result.deleted + result.anonymised - before;
  if (result.expired > 0) {
    logger.warn(
      { expired: result.expired, hasKey: creds !== null },
      'france-travail-sync: offers withdrawn unverified — the board could not be asked in time',
    );
  }

  if (result.checked > 0 || result.deleted > 0 || result.anonymised > 0) {
    logger.info({ ...result, licence: licenceLine(null) }, 'france-travail-sync: done');
  }
  return result;
}

/** The tick's credentials, or null — a missing key is phase 2's problem, not an error here. */
function credentials(context: FetchContext): { client_id: string; client_secret: string } | null {
  try {
    return credentialsFrom(context);
  } catch {
    return null;
  }
}

/**
 * Carries out one plan, counting what it did. Deletions go in batched
 * statements because phase 2's list has no ceiling — a fortnight without a
 * key expires everything at once, and that must not become a row-at-a-time
 * loop. Anonymising stays per row: it writes the same columns to each, and
 * only the offers the user applied to or saved ever reach it.
 */
async function apply(plan: SyncPlan, now: Date, result: MirrorStats): Promise<void> {
  const deleting = plan.flatMap((step) => (step.action === 'delete' ? [step.id] : []));
  for (let i = 0; i < deleting.length; i += DELETE_BATCH) {
    const { count } = await prisma.job.deleteMany({ where: { id: { in: deleting.slice(i, i + DELETE_BATCH) } } });
    result.deleted += count;
  }
  for (const step of plan) {
    if (step.action !== 'anonymise') continue;
    await prisma.job.update({ where: { id: step.id }, data: anonymisedOffer(now) });
    result.anonymised++;
  }
}
