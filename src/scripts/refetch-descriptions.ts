import { AtsType } from '@prisma/client';
import { logger } from '../logger';
import { prisma } from '../db';
import { sleep } from '../http';
import { fetchOne } from '../fetchers/index';

/*
 * One-shot repair: re-pull every board that has stored jobs and update the
 * stored descriptions in place with the current stripHtml output. Only the
 * description column changes — no inserts, no status or classification
 * touches. Companion to backfill-descriptions for rows whose line structure
 * cannot be recovered from the stored text alone. Jobs no longer listed
 * upstream are left as they are.
 *
 * Usage: node dist/scripts/refetch-descriptions.js [--dry-run]
 */

const DRY_RUN = process.argv.includes('--dry-run');
const POLITE_DELAY_MS = 1_000;

async function main(): Promise<void> {
  const companies = await prisma.company.findMany({
    where: { atsType: { not: AtsType.MANUAL }, jobs: { some: {} } },
    select: { id: true, name: true, atsType: true, atsToken: true },
    orderBy: { id: 'asc' },
  });

  let fetched = 0;
  let matched = 0;
  let updated = 0;

  for (const company of companies) {
    try {
      const fresh = await fetchOne(company);
      fetched += fresh.length;
      const stored = await prisma.job.findMany({
        where: { companyId: company.id },
        select: { id: true, externalId: true, description: true },
      });
      const byExternalId = new Map(stored.map((j) => [j.externalId, j]));

      let companyUpdated = 0;
      for (const job of fresh) {
        const row = byExternalId.get(job.externalId);
        if (!row || job.description.length === 0) continue;
        matched++;
        if (row.description === job.description) continue;
        updated++;
        companyUpdated++;
        if (!DRY_RUN) {
          await prisma.job.update({
            where: { id: row.id },
            data: { description: job.description },
          });
        }
      }
      logger.info(
        { company: company.name, ats: company.atsType, fresh: fresh.length, updated: companyUpdated },
        'refetch-descriptions: company done',
      );
    } catch (err) {
      logger.error(
        { err, company: company.name, ats: company.atsType },
        'refetch-descriptions: company failed — skipped',
      );
    }
    await sleep(POLITE_DELAY_MS);
  }

  logger.info(
    { companies: companies.length, fetched, matched, updated, dryRun: DRY_RUN },
    DRY_RUN ? 'refetch-descriptions: dry run — nothing written' : 'refetch-descriptions: done',
  );
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'refetch-descriptions: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
