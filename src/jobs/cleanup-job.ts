import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import type { CronStats } from './cron-run';

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runCleanupJob(): Promise<{ stats: CronStats }> {
  const started = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
  logger.info({ cutoff: cutoff.toISOString() }, 'cleanup-job: start');

  const result = await prisma.job.deleteMany({
    where: {
      status: JobStatus.DISMISSED,
      fetchedAt: { lt: cutoff },
    },
  });

  const durationMs = Date.now() - started;
  logger.info({ deleted: result.count, durationMs }, 'cleanup-job: done');
  return { stats: { deleted: result.count, durationMs } };
}
