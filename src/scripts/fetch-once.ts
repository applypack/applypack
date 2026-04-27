import { logger } from '../logger';
import { prisma } from '../db';
import { runSeed } from '../seed';
import { runFetchJob } from '../jobs/fetch-job';
import { recordCronRun } from '../jobs/cron-run';

async function main(): Promise<void> {
  logger.info('fetch-once: ensuring companies are seeded');
  await runSeed();
  await recordCronRun('fetch', runFetchJob);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'fetch-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
