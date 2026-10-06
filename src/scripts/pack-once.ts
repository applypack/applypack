import { logger } from '../logger';
import { prisma } from '../db';
import { runPackJob } from '../jobs/pack-job';
import { recordCronRun } from '../jobs/cron-run';

// The pack queue, now: what the worker's minute beat does when a pack is waiting (ADR 0063).
recordCronRun('pack', runPackJob)
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'pack-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
