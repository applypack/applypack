import { logger } from '../logger';
import { prisma } from '../db';
import { findCrossListing, simhash64, toDbBigInt } from '../fingerprint';

/*
 * One-shot backfill for F3 (ADR 0018): fingerprint every stored description
 * and link the cross-company near-duplicates that are already in the table.
 * Without it the feature only sees jobs fetched from now on.
 *
 * Annotation only — no row is merged, hidden or deleted, and an existing
 * crossListedOfJobId is never overwritten. Safe to re-run.
 *
 * Usage: node dist/scripts/backfill-fingerprints.js [--dry-run]
 */

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      companyId: true,
      title: true,
      description: true,
      crossListedOfJobId: true,
      company: { select: { name: true } },
    },
    // Oldest first: a duplicate points at the posting we saw first.
    orderBy: { fetchedAt: 'asc' },
  });

  const scanned: Array<{
    id: number;
    companyId: number;
    descriptionSimhash: bigint | null;
    title: string;
    companyName: string;
  }> = [];
  let fingerprinted = 0;
  let skipped = 0;
  let linked = 0;

  for (const job of jobs) {
    const fingerprint = simhash64(job.description);
    if (fingerprint === null) skipped++;
    else fingerprinted++;

    const match =
      job.crossListedOfJobId === null
        ? findCrossListing(fingerprint, job.companyId, scanned)
        : null;

    // Computed outside the dry-run branch on purpose: a value the database
    // would reject must fail the dry run too.
    const stored = toDbBigInt(fingerprint);
    if (!DRY_RUN) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          descriptionSimhash: stored,
          ...(match && { crossListedOfJobId: match.job.id }),
        },
      });
    }

    if (match) {
      linked++;
      logger.info(
        {
          jobId: job.id,
          title: job.title,
          company: job.company.name,
          originalJobId: match.job.id,
          originalTitle: match.job.title,
          originalCompany: match.job.companyName,
          distance: match.distance,
        },
        'backfill-fingerprints: cross-listing',
      );
    }

    scanned.push({
      id: job.id,
      companyId: job.companyId,
      descriptionSimhash: fingerprint,
      title: job.title,
      companyName: job.company.name,
    });
  }

  logger.info(
    { total: jobs.length, fingerprinted, skipped, linked, dryRun: DRY_RUN },
    'backfill-fingerprints: done',
  );
}

main()
  .catch((err) => {
    logger.error({ err }, 'backfill-fingerprints: failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
