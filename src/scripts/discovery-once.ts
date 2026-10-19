import { logger } from '../logger';
import { prisma } from '../db';
import { runDiscoveryJob } from '../jobs/discovery-job';
import { recordCronRun } from '../jobs/cron-run';
import { inRunLocale } from '../run-locale';
import { runSummaryLine } from '../web/runs-summary';

inRunLocale(() => recordCronRun('discovery', runDiscoveryJob))
  .then((stats) => process.stdout.write(`${runSummaryLine('discovery', stats)}\n`))
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'discovery-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
