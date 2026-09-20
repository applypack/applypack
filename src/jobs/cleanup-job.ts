import { CronRunStatus, JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import type { CronStats } from './cron-run';

const RETENTION_DAYS = 30;
const AI_USAGE_RETENTION_DAYS = 60;
/**
 * Run history (D8). Nothing pruned `cron_run` at all, while TASKS and the
 * search-analytics note both said 30 days — after a year of hourly ticks
 * that is around 50 000 rows nobody reads past the first page of /runs.
 *
 * 90 and not 30, because the search funnel that is coming (N1) reads this
 * history to say how many postings a search turned into matches, and a month
 * is too short a window to see a seasonal search in. When the funnel lands
 * with its daily rollup, the raw rows may go back to 30 — the rollup is what
 * has to outlive them.
 */
const RUN_RETENTION_DAYS = 90;
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
    UPDATE app_settings SET "aiUsage" = (
      SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
      FROM jsonb_each(COALESCE("aiUsage", '{}'::jsonb))
      WHERE key >= ${usageCutoff}
    ) WHERE id = 1`;

  // Employer mode (ADR 0048): a screening past its date goes with every
  // applicant file and verdict — the cascade is the retention policy.
  const screenings = await prisma.screening.deleteMany({ where: { retainUntil: { lt: new Date() } } });

  // Run history. A run still going is never swept, however old its row looks:
  // a tick that outlived the cutoff is a tick to investigate, not to delete.
  const runCutoff = new Date(Date.now() - RUN_RETENTION_DAYS * DAY_MS);
  const runs = await prisma.cronRun.deleteMany({
    where: { startedAt: { lt: runCutoff }, status: { not: CronRunStatus.RUNNING } },
  });

  const durationMs = Date.now() - started;
  logger.info(
    { deleted: result.count, screeningsDeleted: screenings.count, runsDeleted: runs.count, durationMs },
    'cleanup-job: done',
  );
  return {
    stats: { deleted: result.count, screeningsDeleted: screenings.count, runsDeleted: runs.count, durationMs },
  };
}
