import { CronRunStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';

export type CronStats = Record<string, number | string | boolean | null>;

interface RunResult<T> {
  result: T;
  stats?: CronStats;
}

/**
 * Wraps a cron task with start/finish bookkeeping in the CronRun table.
 *
 * The wrapped function may either return void (no stats), or return
 * { result, stats } to record structured stats on the row.
 */
export async function recordCronRun<T>(
  name: string,
  fn: () => Promise<T> | Promise<RunResult<T>> | Promise<void>,
): Promise<void> {
  const run = await prisma.cronRun.create({
    data: { name, status: CronRunStatus.RUNNING },
  });

  try {
    const ret = await fn();
    const stats = extractStats(ret);
    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: CronRunStatus.OK,
        finishedAt: new Date(),
        stats: stats ?? Prisma.JsonNull,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, name, runId: run.id }, 'cron-run: task failed');
    await prisma.cronRun
      .update({
        where: { id: run.id },
        data: {
          status: CronRunStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: message.slice(0, 1000),
        },
      })
      .catch((updateErr) =>
        logger.error(
          { err: updateErr, runId: run.id },
          'cron-run: failed to record failure',
        ),
      );
    throw err;
  }
}

/**
 * When the previous successful run of `name` started, or null if it has never
 * finished one. The current run's own row is still RUNNING while its task
 * executes, so a caller inside a job reads the run before it — which is what
 * "since the last one" means.
 */
export async function lastSuccessfulRunAt(name: string): Promise<Date | null> {
  const row = await prisma.cronRun.findFirst({
    where: { name, status: CronRunStatus.OK },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  return row?.startedAt ?? null;
}

function extractStats(ret: unknown): CronStats | null {
  if (
    ret &&
    typeof ret === 'object' &&
    'stats' in ret &&
    ret.stats &&
    typeof ret.stats === 'object'
  ) {
    return ret.stats as CronStats;
  }
  return null;
}
