import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import type { MatchMode } from '../resume/match-mode';

/*
 * In-memory registry for long compare runs (extract → scan → match). The
 * POST returns immediately with a redirect to /target/runs/:id; the page
 * polls /target/runs/:id/state until the async chain flips the run to done
 * or error. Web-process-only state; a restart simply forgets unfinished
 * runs (node-cron philosophy: no queue, ADR 0003).
 */

export type RunStep =
  | 'fetch'
  | 'extract'
  | 'scan'
  | 'keywords'
  | 'match'
  | 'suggestions'
  | 'verify'
  | 'letter'
  | 'review'
  | 'score';
export type RunStage = RunStep | 'done' | 'error';

/** The comparison step a mode runs as: the quick check or the full report (ADR 0029). */
export function matchStep(mode: MatchMode): RunStep {
  return mode === 'fast' ? 'keywords' : 'match';
}

export interface TargetRun {
  id: string;
  steps: RunStep[];
  stage: RunStage;
  startedAt: number;
  /** When the current stage began — paces the progress page's activity line. */
  stageAt: number;
  /** How long each finished step took — shown next to it on the progress page. */
  stepMs: Partial<Record<RunStep, number>>;
  jobTitle: string;
  resumeName: string;
  /** Where the error state sends the user back to — the launcher that started it. */
  backUrl: string;
  backLabel: string;
  /** Set once the job row exists — the error state can link to it. */
  jobId?: number;
  /** Page copy for runs that are not a comparison (the wizard's scan / score). */
  heading?: { running: string; failed: string };
  subtitle?: string;
  /** Data-driven progress of the active step, when the job reports it. */
  progress?: { done: number; total: number };
  /** Set on done: where to send the user, with the flash to show there. */
  resultUrl?: string;
  flash?: string;
  /** Done with a stored analysis, not a fresh one — the flash warns and offers "Re-run anyway". */
  reused?: boolean;
  error?: string;
  /**
   * What this run is working on — a second POST for the same thing joins it
   * (issue #76). More than one name, because one run can answer requests that
   * arrive under different names: /target's suggest path is both "this
   * posting and this resume" and "the suggestions for this comparison", and a
   * request under either must join it rather than call the model again.
   */
  keys: string[];
}

const RUN_TTL_MS = 30 * 60_000;
const runs = new Map<string, TargetRun>();

/** Registers a run. Private: every start goes through `claimRun`, which is what makes a second POST join instead of duplicate. */
function createRun(
  fields: Pick<TargetRun, 'steps' | 'jobTitle' | 'resumeName'> &
    Partial<Pick<TargetRun, 'jobId' | 'backUrl' | 'backLabel' | 'heading' | 'subtitle'>>,
): TargetRun {
  prune();
  const run: TargetRun = {
    id: randomUUID(),
    keys: [],
    stage: fields.steps[0] ?? 'match',
    startedAt: Date.now(),
    stageAt: Date.now(),
    stepMs: {},
    backUrl: '/target',
    backLabel: 'Back to Target',
    ...fields,
  };
  runs.set(run.id, run);
  return run;
}

/**
 * Start the work, or hand back the run already doing it (issue #76).
 *
 * `SUBMIT_ONCE` disables the buttons in the browser, which is the wrong place
 * for the guarantee: it is inline JS, and it cannot help a second tab, a
 * reload of the POST, or a client with scripting off. The registry can, and
 * needs nothing new to do it — a `key` naming the work (this job, this resume,
 * this text) is enough to recognise the second request as the same one.
 *
 * The lookup and the insert are one synchronous statement pair with no `await`
 * between them, and that is the whole guarantee: a Node request handler runs
 * to its next suspension point before any other can resume, so two POSTs in
 * flight cannot both find nothing. Finished runs are not matched, so asking
 * again after an answer starts a fresh one, exactly as before.
 */
export function claimRun(
  key: string,
  fields: Parameters<typeof createRun>[0],
): { run: TargetRun; joined: boolean } {
  // Prune first: a run that died mid-flight (a web restart, a crash between
  // ticks) stays "in flight" forever otherwise, and every retry would join a
  // run that will never move.
  prune();
  const live = findLiveRun(key);
  if (live) {
    logger.info({ runId: live.id, key }, 'run: joined a run already in flight');
    return { run: live, joined: true };
  }
  const run = createRun(fields);
  run.keys.push(key);
  return { run, joined: false };
}

/** The unfinished run answering to `key`, if one is in flight. */
export function findLiveRun(key: string): TargetRun | null {
  for (const run of runs.values()) {
    if (run.keys.includes(key) && run.stage !== 'done' && run.stage !== 'error') return run;
  }
  return null;
}

/**
 * Gives a run another name to be found by, once it turns out to be doing work
 * a different request would ask for. Idempotent, and a no-op on a run that has
 * gone: only a live run is worth joining.
 */
export function alsoClaims(id: string, key: string): void {
  const run = runs.get(id);
  if (!run || run.keys.includes(key)) return;
  run.keys.push(key);
  logger.info({ runId: id, key }, 'run: also answering to another name');
}

/** `keys` is not patchable: a run's names are claimed, never overwritten. */
export function updateRun(id: string, patch: Partial<Omit<TargetRun, 'id' | 'keys'>>): void {
  const run = runs.get(id);
  if (!run) return;
  if (patch.stage && patch.stage !== run.stage) {
    const now = Date.now();
    const ms = now - run.stageAt;
    if (run.stage !== 'done' && run.stage !== 'error') run.stepMs[run.stage] = ms;
    logger.info(
      { runId: id, step: run.stage, ms, next: patch.stage, totalMs: now - run.startedAt },
      'run: step finished',
    );
    run.stageAt = now;
  }
  Object.assign(run, patch);
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
