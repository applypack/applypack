import { logger } from '../logger';
import { prisma } from '../db';
import { runHnHiringJob } from '../jobs/hn-hiring-job';
import { recordCronRun } from '../jobs/cron-run';

recordCronRun('hn-hiring', runHnHiringJob)
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'hn-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
