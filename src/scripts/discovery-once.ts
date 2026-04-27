import { logger } from '../logger';
import { prisma } from '../db';
import { runDiscoveryJob } from '../jobs/discovery-job';
import { recordCronRun } from '../jobs/cron-run';

recordCronRun('discovery', runDiscoveryJob)
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'discovery-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
