import { randomUUID } from 'node:crypto';
import { logger } from '../logger';

/*
 * In-memory registry for long compare runs (classify → scan → match). The
 * POST returns immediately with a redirect to /target/runs/:id, which
 * meta-refreshes until the async chain flips the run to done or error.
 * Web-process-only state; a restart simply forgets unfinished runs
 * (node-cron philosophy: no queue, ADR 0003).
 */

export type RunStep = 'classify' | 'scan' | 'match';
export type RunStage = RunStep | 'done' | 'error';

export interface TargetRun {
  id: string;
  steps: RunStep[];
  stage: RunStage;
  startedAt: number;
  jobTitle: string;
  resumeName: string;
  /** Set once the job row exists — the error state can link to it. */
  jobId?: number;
  /** Set on done: where to send the user, with the flash to show there. */
  resultUrl?: string;
  flash?: string;
  error?: string;
}

const RUN_TTL_MS = 30 * 60_000;
const runs = new Map<string, TargetRun>();

export function createRun(
  fields: Pick<TargetRun, 'steps' | 'jobTitle' | 'resumeName'> & Partial<Pick<TargetRun, 'jobId'>>,
): TargetRun {
  prune();
  const run: TargetRun = {
    id: randomUUID(),
    stage: fields.steps[0] ?? 'match',
    startedAt: Date.now(),
    ...fields,
  };
  runs.set(run.id, run);
  return run;
}

export function updateRun(id: string, patch: Partial<Omit<TargetRun, 'id'>>): void {
  const run = runs.get(id);
  if (run) Object.assign(run, patch);
}

export function getRun(id: string): TargetRun | null {
  return runs.get(id) ?? null;
}

/** Runs the async chain; any uncaught failure flips the run to error. */
export function startRun(id: string, fn: () => Promise<void>): void {
  void fn().catch((err) => {
    logger.error({ err, runId: id }, 'web: compare run failed');
    updateRun(id, { stage: 'error', error: 'Unexpected failure — see the web logs.' });
  });
}

function prune(): void {
  const cutoff = Date.now() - RUN_TTL_MS;
  for (const [id, run] of runs) {
    if (run.startedAt < cutoff) runs.delete(id);
  }
}
