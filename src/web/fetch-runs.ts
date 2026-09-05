import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import type { CronStats } from '../jobs/cron-run';
import type { SourceProgress } from '../fetchers';
import { isFailureStatus } from '../fetchers/source-health';

/*
 * In-memory registry for "Fetch now" — the fetch tick started from the
 * dashboard instead of the cron. Same shape as target-runs.ts: the POST
 * returns at once with a redirect to /runs/fetch-now/:id, whose page polls
 * the state route until the run flips to done or error. The CronRun row
 * ('fetch-now') is the durable record on /runs; a web restart only forgets
 * the live progress (ADR 0003: no queue).
 */

export type FetchRunStage = 'fetch' | 'store' | 'done' | 'error';
/** What the walk asks: every due source, or the aggregators alone (the wizard's test search). */
export type FetchScope = 'every' | 'aggregators';

export const FETCH_RUN_STEPS: FetchRunStage[] = ['fetch', 'store'];

export interface FetchRun {
  id: string;
  stage: FetchRunStage;
  startedAt: number;
  /** When the current stage began — paces the progress page's activity line. */
  stageAt: number;
  /** False while the pipeline is paused: jobs are stored unscored. */
  classify: boolean;
  /** Where the verdict lands: /runs, or /welcome for the wizard's test search. */
  backUrl: string;
  scope: FetchScope;
  sourcesDone: number;
  /** Unknown until the first source answers. */
  sourcesTotal: number | null;
  jobsFetched: number;
  /** The last source that answered, for the activity line. */
  lastSource: { name: string; count: number; failed: boolean; durationMs: number } | null;
  stats?: CronStats;
  error?: string;
}

const RUN_TTL_MS = 30 * 60_000;
const runs = new Map<string, FetchRun>();

export function createFetchRun(fields: Pick<FetchRun, 'classify' | 'backUrl' | 'scope'>): FetchRun {
  prune();
  const run: FetchRun = {
    id: randomUUID(),
    stage: 'fetch',
    startedAt: Date.now(),
    stageAt: Date.now(),
    sourcesDone: 0,
    sourcesTotal: null,
    jobsFetched: 0,
    lastSource: null,
    ...fields,
  };
  runs.set(run.id, run);
  return run;
}

export function updateFetchRun(id: string, patch: Partial<Omit<FetchRun, 'id'>>): void {
  const run = runs.get(id);
  if (!run) return;
  if (patch.stage && patch.stage !== run.stage) run.stageAt = Date.now();
  Object.assign(run, patch);
}

export function recordSource(id: string, p: SourceProgress): void {
  const run = runs.get(id);
  if (!run) return;
  run.sourcesDone = p.done;
  run.sourcesTotal = p.total;
  run.jobsFetched += p.count;
  run.lastSource = { name: p.company, count: p.count, failed: isFailureStatus(p.status), durationMs: p.durationMs };
}

export function getFetchRun(id: string): FetchRun | null {
  return runs.get(id) ?? null;
}

/** The in-flight guard: at most one manual fetch at a time per web process. */
export function activeFetchRun(): FetchRun | null {
  for (const run of runs.values()) {
    if (run.stage === 'fetch' || run.stage === 'store') return run;
  }
  return null;
}

/** Runs the tick; any uncaught failure flips the run to error. */
export function startFetchRun(id: string, fn: () => Promise<void>): void {
  void fn().catch((err) => {
    logger.error({ err, runId: id }, 'web: fetch-now run failed');
    updateFetchRun(id, { stage: 'error', error: 'The run failed — see the web logs and the row on /runs.' });
  });
}

function prune(): void {
  const cutoff = Date.now() - RUN_TTL_MS;
  for (const [id, run] of runs) {
    if (run.startedAt < cutoff) runs.delete(id);
  }
}
