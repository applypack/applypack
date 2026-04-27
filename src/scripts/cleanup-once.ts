import { logger } from '../logger';
import { prisma } from '../db';
import { runCleanupJob } from '../jobs/cleanup-job';
import { recordCronRun } from '../jobs/cron-run';

recordCronRun('cleanup', runCleanupJob)
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'cleanup-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
