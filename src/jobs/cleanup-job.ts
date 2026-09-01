import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import type { CronStats } from './cron-run';

const RETENTION_DAYS = 30;
const AI_USAGE_RETENTION_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runCleanupJob(): Promise<{ stats: CronStats }> {
  const started = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
  logger.info({ cutoff: cutoff.toISOString() }, 'cleanup-job: start');

  // pipelineStage: null — an application's funnel history (and its F5
  // ledger, which cascades with the job) is never garbage-collected.
  const result = await prisma.job.deleteMany({
    where: {
      status: JobStatus.DISMISSED,
      pipelineStage: null,
      fetchedAt: { lt: cutoff },
    },
  });

  // Trim old AI-usage day buckets in one atomic statement — day keys are
  // ISO dates, so a plain string compare is a date compare.
  const usageCutoff = new Date(Date.now() - AI_USAGE_RETENTION_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  await prisma.$executeRaw`
    UPDATE "AppSettings" SET "aiUsage" = (
      SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
      FROM jsonb_each(COALESCE("aiUsage", '{}'::jsonb))
      WHERE key >= ${usageCutoff}
    ) WHERE id = 1`;

  const durationMs = Date.now() - started;
  logger.info({ deleted: result.count, durationMs }, 'cleanup-job: done');
  return { stats: { deleted: result.count, durationMs } };
}
