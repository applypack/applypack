import { logger } from '../logger';
import { prisma } from '../db';
import { runDigestJob } from '../jobs/digest-job';
import { recordCronRun } from '../jobs/cron-run';

recordCronRun('digest', runDigestJob)
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'digest-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
