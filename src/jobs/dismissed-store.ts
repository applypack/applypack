import { prisma } from '../db';

/*
 * What is kept of a Dismissed posting once its text is gone (#474). The
 * weekly cleanup deletes a Dismissed posting a month after it was found, and
 * a board that still lists it, a file imported again or a folder read again
 * brought it back as new: scored again, dismissed again, every month. So the
 * cleanup keeps its source, its id and when it was first seen — no text, no
 * verdict — and a key kept here counts as stored. The only file that touches
 * `dismissed_posting`; a key goes with its source.
 */

/** How long the key of a deleted dismissal counts as stored, from the day the posting was first seen. */
const KEY_KEPT_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes the Dismissed postings first seen before `cutoff` that carry no
 * application stage (an application's history is never swept), keeping each
 * one's key. One statement, so no posting is ever gone without its key. A key
 * kept already — a paste stored again and dismissed again — takes the later
 * day. Returns how many postings were deleted.
 */
export async function deleteDismissed(cutoff: Date): Promise<number> {
  // The column holds UTC without a zone, as Prisma writes it: the cutoff is read in UTC too, whatever the session's zone.
  return prisma.$executeRaw`
    WITH gone AS (
      DELETE FROM "job"
      WHERE "status" = 'DISMISSED' AND "pipelineStage" IS NULL AND "fetchedAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')
      RETURNING "companyId", "externalId", "fetchedAt"
    )
    INSERT INTO "dismissed_posting" ("companyId", "externalId", "seenAt")
    SELECT "companyId", "externalId", "fetchedAt" FROM gone
    ON CONFLICT ("companyId", "externalId") DO UPDATE SET "seenAt" = GREATEST("dismissed_posting"."seenAt", EXCLUDED."seenAt")`;
}

/** Forgets the keys of postings first seen longer ago than they are kept: a source listing one after that pays one more scoring. */
export async function forgetOldDismissals(now: Date): Promise<number> {
  const { count } = await prisma.dismissedPosting.deleteMany({
    where: { seenAt: { lt: new Date(now.getTime() - KEY_KEPT_DAYS * DAY_MS) } },
  });
  return count;
}

/**
 * The kept keys among these companies × these external ids — a superset of
 * the batch's pairs, as `process-jobs.ts:storedKeys` reads the stored rows;
 * the caller holds the exact pairs.
 */
export async function dismissedKeys(companyIds: readonly number[], externalIds: readonly string[]): Promise<{ companyId: number; externalId: string }[]> {
  if (companyIds.length === 0 || externalIds.length === 0) return [];
  return prisma.dismissedPosting.findMany({
    where: { companyId: { in: [...companyIds] }, externalId: { in: [...externalIds] } },
    select: { companyId: true, externalId: true },
  });
}

/** Which of one source's external ids it holds already: a stored job, or the key of a deleted dismissal. What an import's preview counts as not new. */
export async function knownIds(companyId: number, externalIds: readonly string[]): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const ids = [...new Set(externalIds)];
  const [stored, dismissed] = await Promise.all([
    prisma.job.findMany({ where: { companyId, externalId: { in: ids } }, select: { externalId: true } }),
    dismissedKeys([companyId], ids),
  ]);
  return new Set([...stored, ...dismissed].map((row) => row.externalId));
}
