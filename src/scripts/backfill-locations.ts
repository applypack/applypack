import { logger } from '../logger';
import { prisma } from '../db';
import { WORKPLACE_LABEL, parseLocation, type WorkplaceCode } from '../location';
import { placeLabel } from '../countries';

/*
 * One-shot backfill for ADR 0031: fill Job.workplace / countries / regions /
 * locationSource on the rows stored before the columns existed, from the
 * location string alone. No AI call, no HTTP.
 *
 * Only those four columns are written — `location` and `description` are
 * never touched, and no row is hidden, merged or deleted. Rows already marked
 * `structured` came from a source's own fields, which this script cannot
 * reproduce, so they are left alone. Idempotent: a row whose columns already
 * equal the parse is skipped. --dry-run reads only and prints the
 * distribution, which is the thing to check by hand before the real run.
 *
 * Usage: node dist/scripts/backfill-locations.js [--dry-run]
 */

const DRY_RUN = process.argv.includes('--dry-run');
/** How many of the most common readings to print per bucket. */
const TOP = 15;

async function main(): Promise<void> {
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      location: true,
      workplace: true,
      countries: true,
      regions: true,
      locationSource: true,
    },
    orderBy: { id: 'asc' },
  });

  const byWorkplace = new Map<WorkplaceCode, number>();
  const byPlace = new Map<string, number>();
  let unknownPlace = 0;
  let structured = 0;
  let updated = 0;

  for (const job of jobs) {
    if (job.locationSource === 'structured') {
      structured++;
      continue;
    }
    const place = parseLocation(job.location);
    tally(byWorkplace, place.workplace);
    for (const code of [...place.countries, ...place.regions]) tally(byPlace, code);
    if (place.countries.length === 0 && place.regions.length === 0) unknownPlace++;

    const unchanged =
      job.workplace === place.workplace &&
      sameList(job.countries, place.countries) &&
      sameList(job.regions, place.regions) &&
      job.locationSource === place.source;
    if (unchanged) continue;

    updated++;
    logger.debug(
      { jobId: job.id, location: job.location, ...place },
      'backfill-locations: parsed',
    );
    if (!DRY_RUN) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          workplace: place.workplace,
          countries: place.countries,
          regions: place.regions,
          locationSource: place.source,
        },
      });
    }
  }

  logger.info(
    {
      total: jobs.length,
      structured,
      updated,
      unknownPlace,
      workplace: Object.fromEntries(
        [...byWorkplace].map(([code, n]) => [WORKPLACE_LABEL[code], n]),
      ),
      places: Object.fromEntries(
        [...byPlace]
          .sort((a, b) => b[1] - a[1])
          .slice(0, TOP)
          .map(([code, n]) => [`${code} ${placeLabel(code)}`, n]),
      ),
      dryRun: DRY_RUN,
    },
    'backfill-locations: done',
  );
}

function tally<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

main()
  .catch((err) => {
    logger.error({ err }, 'backfill-locations: failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
