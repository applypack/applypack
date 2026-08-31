import { AtsType } from '@prisma/client';
import { logger } from '../logger';
import { prisma } from '../db';
import { APPLY_LINK_FLAGS, checkApplyLink } from '../apply-link';

/*
 * One-shot backfill for F13 (ADR 0023): annotate stored postings whose apply
 * link cannot be applied through. Without it the flags only appear on jobs
 * fetched or re-classified from now on, and a full re-classify costs AI calls
 * this backfill does not.
 *
 * Additive and idempotent — a tag is appended to Job.redFlags only when it is
 * absent, no other field is touched, and no row is hidden, merged or deleted.
 * Safe to re-run. --dry-run reads only.
 *
 * Usage: node dist/scripts/backfill-apply-link-flags.js [--dry-run]
 */

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      url: true,
      redFlags: true,
      company: { select: { name: true, atsType: true } },
    },
    orderBy: { id: 'asc' },
  });

  const perFlag = new Map<string, number>(APPLY_LINK_FLAGS.map((f) => [f, 0]));
  let flagged = 0;
  let updated = 0;

  for (const job of jobs) {
    const flags = checkApplyLink({
      url: job.url,
      pasted: job.company.atsType === AtsType.MANUAL,
    });
    if (flags.length === 0) continue;
    flagged++;
    for (const flag of flags) perFlag.set(flag, (perFlag.get(flag) ?? 0) + 1);

    const missing = flags.filter((f) => !job.redFlags.includes(f));
    logger.info(
      {
        jobId: job.id,
        title: job.title,
        company: job.company.name,
        url: job.url,
        flags,
        alreadyPresent: missing.length === 0,
      },
      'backfill-apply-link-flags: flagged',
    );
    if (missing.length === 0) continue;

    updated++;
    if (!DRY_RUN) {
      await prisma.job.update({
        where: { id: job.id },
        data: { redFlags: [...job.redFlags, ...missing] },
      });
    }
  }

  logger.info(
    {
      total: jobs.length,
      flagged,
      updated,
      ...Object.fromEntries(perFlag),
      dryRun: DRY_RUN,
    },
    'backfill-apply-link-flags: done',
  );
}

main()
  .catch((err) => {
    logger.error({ err }, 'backfill-apply-link-flags: failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
