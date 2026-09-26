import { logger } from '../logger';
import { prisma } from '../db';
import { runSeed } from '../seed';
import { runFetchJob } from '../jobs/fetch-job';
import { recordCronRun } from '../jobs/cron-run';

/**
 * One fetch tick from the command line — "Fetch now" without the dashboard,
 * and the smoke run for a new fetcher. Like the button it asks every source
 * whatever the schedule says, stores the jobs unscored while fetching is
 * paused, and is recorded as 'fetch-now', so it does not reset the cadence
 * clock the scheduled ticks read.
 */
async function main(): Promise<void> {
  logger.info('fetch-once: ensuring companies are seeded');
  await runSeed();
  await recordCronRun('fetch-now', () => runFetchJob({ manual: true }));
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'fetch-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
