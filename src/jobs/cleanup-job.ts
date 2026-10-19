import { CronRunStatus } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import type { CronStats } from './cron-run';
import { deleteDismissed, forgetOldDismissals } from './dismissed-store';
import { checkForUpdate } from '../update-check';

/** A Dismissed posting's text, counted from the day it was found; its key stays longer (dismissed-store.ts, #474). */
const RETENTION_DAYS = 30;
/** The AI ledger (ADR 0055): long enough for "this year" and last year's same month. */
const AI_CALL_RETENTION_DAYS = 400;
/**
 * Run history. Nothing pruned `cron_run` at all, while TASKS and the
 * search-analytics note both said 30 days — after a year of hourly ticks
 * that is around 50 000 rows nobody reads past the first page of /runs.
 *
 * 90 and not 30: a month is too short to see a seasonal search in. The
 * search funnel keeps its own daily rollup (`funnel_day`, never pruned), so
 * what a search turned into matches outlives the raw rows either way.
 */
const RUN_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runCleanupJob(): Promise<{ stats: CronStats }> {
  const started = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
  logger.info({ cutoff: cutoff.toISOString() }, 'cleanup-job: start');

  // An application's funnel history (and its F5 ledger, which cascades with
  // the job) is never garbage-collected. What goes leaves its key behind, so
  // a source that still lists it does not bring it back to be scored (#474).
  const deleted = await deleteDismissed(cutoff);
  const dismissalsForgotten = await forgetOldDismissals(new Date());

  // The optional weekly look for a newer release (TASKS N9); off unless turned on.
  await checkForUpdate();

  const aiCalls = await prisma.aiCall.deleteMany({
    where: { at: { lt: new Date(Date.now() - AI_CALL_RETENTION_DAYS * DAY_MS) } },
  });

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
  const stats = {
    deleted,
    dismissalsForgotten,
    screeningsDeleted: screenings.count,
    runsDeleted: runs.count,
    aiCallsDeleted: aiCalls.count,
    durationMs,
  };
  logger.info(stats, 'cleanup-job: done');
  return { stats };
}
