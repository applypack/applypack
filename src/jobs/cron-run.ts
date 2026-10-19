import { CronRunStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import type { WordedCount } from '../web/runs-summary';

/** Every job that writes a run row: /runs and the Overview word each through the catalog (`runs-summary.ts:runName`). */
export type RunName =
  | 'fetch'
  | 'fetch-now'
  | 'folder-watch'
  | 'hn-hiring'
  | 'import'
  | 'digest'
  | 'stale-applications'
  | 'cleanup'
  | 'discovery'
  | 'pack'
  | 'reclassify-all'
  | 'score-unscored';

/** One source's answer in a fetch tick — which boards took the time and which failed (docs/onboarding-sources.md §1). */
export type SourceStat = {
  name: string;
  status: string;
  count: number;
  ms: number;
  /** The source's `atsType`, so a folder's status is said in a folder's words; absent on rows stored before it. */
  kind?: string;
};

/** A run's facts as stored. `undefined` is a key one of a job's returns leaves out: JSON drops it. */
export type CronStats = Record<string, number | string | boolean | null | undefined | SourceStat[]>;

/** The keys of a stats shape whose value is a number, over every shape a job returns. */
export type CountsOf<T> = T extends unknown ? { [K in keyof T]-?: [NonNullable<T[K]>] extends [never] ? never : NonNullable<T[K]> extends number ? K : never }[keyof T] : never;

/** The stats of every shape a task may return. */
type StatsIn<R> = R extends { stats: infer S } ? S : never;

/**
 * A task's stats hold no count /runs has no words for: `tsc` names such a
 * count at the task that writes it — a job's return and a literal written
 * inline at `recordCronRun` alike (#606, #622).
 */
type Worded<N extends RunName, R> = { stats: Partial<Record<Exclude<CountsOf<StatsIn<R>>, WordedCount<N>>, never>> };

/**
 * Wraps a cron task with start/finish bookkeeping in the CronRun table.
 *
 * The wrapped function returns { stats } to record structured stats on the
 * row. The stats come back too: a once-script prints them for the terminal
 * that ran it.
 */
export async function recordCronRun<N extends RunName, R extends { stats: object }>(
  name: N,
  fn: () => Promise<R & Worded<N, R>>,
): Promise<CronStats | null> {
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
    return stats;
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
export async function lastSuccessfulRunAt(name: RunName): Promise<Date | null> {
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
