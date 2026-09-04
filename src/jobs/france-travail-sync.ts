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
 * deleted or changed is deleted or changed here. The planner is pure; the
 * runner asks the detail resource for every stored France Travail offer
 * whose last check is older than a day — 200 keeps it (and refreshes it
 * when the board changed it), 204 withdraws it. A withdrawn offer is
 * deleted, unless it is the user's own record (applied, saved, or moved on
 * the board), in which case it stays with its content anonymised as art. 7
 * lists: employer, contact, description, offer URL, commune.
 */

/** Checks per tick — at one every CALL_GAP_MS that is under a minute of calls. */
export const MAX_CHECKS_PER_TICK = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoredOffer {
  id: number;
  externalId: string;
  status: JobStatus;
  pipelineStage: string | null;
}

export type SyncPlan = { action: 'delete' | 'anonymise' | 'keep'; id: number }[];

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

/** Which stored offers are due: never checked, or checked more than a day ago. */
export function dueBefore(now: Date): Date {
  return new Date(now.getTime() - DAY_MS);
}

/**
 * The daily mirror. Runs on every tick and does the work that is due, so a
 * missed hour never becomes a missed day; nothing happens without keys or
 * without an active France Travail row.
 */
export async function syncFranceTravail(context: FetchContext, isCancelled?: () => Promise<boolean>): Promise<{ checked: number; deleted: number; anonymised: number }> {
  const result = { checked: 0, deleted: 0, anonymised: 0 };
  const rows = await prisma.company.findMany({ where: { atsType: AtsType.FRANCETRAVAIL, active: true }, select: { id: true } });
  if (rows.length === 0) return result;
  let creds;
  try {
    creds = credentialsFrom(context);
  } catch {
    return result;
  }
  const now = context.now ?? new Date();
  const due = await prisma.job.findMany({
    where: {
      companyId: { in: rows.map((r) => r.id) },
      OR: [{ sourceCheckedAt: null }, { sourceCheckedAt: { lt: dueBefore(now) } }],
    },
    select: { id: true, externalId: true, status: true, pipelineStage: true, companyId: true, sourceUpdatedAt: true },
    orderBy: { sourceCheckedAt: 'asc' },
    take: MAX_CHECKS_PER_TICK,
  });
  const gone = new Set<string>();
  for (const job of due) {
    if (isCancelled && (await isCancelled())) break;
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
  for (const step of planSync(due, gone)) {
    if (step.action === 'delete') {
      await prisma.job.delete({ where: { id: step.id } });
      result.deleted++;
    } else if (step.action === 'anonymise') {
      await prisma.job.update({ where: { id: step.id }, data: anonymisedOffer(now) });
      result.anonymised++;
    }
  }
  if (result.checked > 0) logger.info({ ...result, licence: licenceLine(null) }, 'france-travail-sync: done');
  return result;
}
