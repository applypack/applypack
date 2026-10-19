import { logger } from '../logger';
import { prisma } from '../db';
import { runHnHiringJob } from '../jobs/hn-hiring-job';
import { recordCronRun } from '../jobs/cron-run';
import { inRunLocale } from '../run-locale';
import { runSummaryLine } from '../web/runs-summary';

inRunLocale(() => recordCronRun('hn-hiring', runHnHiringJob))
  .then((stats) => process.stdout.write(`${runSummaryLine('hn-hiring', stats)}\n`))
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'hn-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
