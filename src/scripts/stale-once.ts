import { logger } from '../logger';
import { prisma } from '../db';
import { runStaleApplicationsJob } from '../jobs/stale-applications-job';
import { recordCronRun } from '../jobs/cron-run';
import { inRunLocale } from '../run-locale';
import { runSummaryLine } from '../web/runs-summary';

inRunLocale(() => recordCronRun('stale-applications', runStaleApplicationsJob))
  .then((stats) => process.stdout.write(`${runSummaryLine('stale-applications', stats)}\n`))
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'stale-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
