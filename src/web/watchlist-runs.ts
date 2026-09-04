import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import type { ResolvedCompany } from '../watchlist/resolve';

/*
 * In-memory registry for a "Add companies" resolve run (TASKS §17 stage A) —
 * the same shape as fetch-runs.ts and target-runs.ts, and for the same
 * reason: resolving twenty URLs is a minute of requests, so the POST returns
 * at once and a progress page polls until it is done. Nothing durable is
 * written until the user confirms the preview, so a web restart costs a
 * re-run and nothing else (ADR 0003: no queue).
 */

const RUN_TTL_MS = 30 * 60_000;

export interface WatchlistRun {
  id: string;
  startedAt: number;
  done: boolean;
  total: number;
  /** Resolved so far, in the order the user pasted them. */
  results: ResolvedCompany[];
  /** The URL being resolved right now, for the activity line. */
  current: string | null;
  /** Lines that carried no URL, kept from the parse so the preview can say so. */
  rejected: string[];
  error?: string;
}

const runs = new Map<string, WatchlistRun>();

export function createWatchlistRun(total: number, rejected: string[]): WatchlistRun {
  prune();
  const run: WatchlistRun = {
    id: randomUUID(),
    startedAt: Date.now(),
    done: false,
    total,
    results: [],
    current: null,
    rejected,
  };
  runs.set(run.id, run);
  return run;
}

export function getWatchlistRun(id: string): WatchlistRun | null {
  return runs.get(id) ?? null;
}

export function recordResolved(id: string, result: ResolvedCompany): void {
  const run = runs.get(id);
  if (!run) return;
  run.results.push(result);
  run.current = null;
}

export function markResolving(id: string, url: string): void {
  const run = runs.get(id);
  if (run) run.current = url;
}

export function finishWatchlistRun(id: string, error?: string): void {
  const run = runs.get(id);
  if (!run) return;
  run.done = true;
  run.current = null;
  if (error !== undefined) run.error = error;
}

/** At most one resolve at a time per web process — they all spend the same politeness budget. */
export function activeWatchlistRun(): WatchlistRun | null {
  for (const run of runs.values()) if (!run.done) return run;
  return null;
}

export function startWatchlistRun(id: string, fn: () => Promise<void>): void {
  void fn().catch((err) => {
    logger.error({ err, runId: id }, 'web: watchlist resolve failed');
    finishWatchlistRun(id, 'The run failed — see the web logs.');
  });
}

function prune(): void {
  const cutoff = Date.now() - RUN_TTL_MS;
  for (const [id, run] of runs) if (run.startedAt < cutoff) runs.delete(id);
}
