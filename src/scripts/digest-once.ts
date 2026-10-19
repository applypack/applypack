import { logger } from '../logger';
import { prisma } from '../db';
import { runDigestJob } from '../jobs/digest-job';
import { recordCronRun } from '../jobs/cron-run';
import { inRunLocale } from '../run-locale';
import { runSummaryLine } from '../web/runs-summary';

inRunLocale(() => recordCronRun('digest', runDigestJob))
  .then((stats) => process.stdout.write(`${runSummaryLine('digest', stats)}\n`))
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'digest-once: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
