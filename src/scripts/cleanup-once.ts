import { logger } from '../logger';
import { prisma } from '../db';
import { runCleanupJob } from '../jobs/cleanup-job';
import { recordCronRun } from '../jobs/cron-run';
import { inRunLocale } from '../run-locale';
import { runSummaryLine } from '../web/runs-summary';

inRunLocale(() => recordCronRun('cleanup', runCleanupJob))
  .then((stats) => process.stdout.write(`${runSummaryLine('cleanup', stats)}\n`))
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'cleanup-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
