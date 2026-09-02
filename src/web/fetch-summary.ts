import type { CronStats } from '../jobs/cron-run';
import type { FlashKind } from './flash';
import { formatDuration } from './format';

/*
 * The one-line verdict of a finished "Fetch now" run, built from the
 * CronRun stats runFetchJob returns. Pure — tested in fetch-summary.test.ts.
 */

function num(stats: CronStats, key: string): number {
  const v = stats[key];
  return typeof v === 'number' ? v : 0;
}

export function summarizeFetchRun(stats: CronStats): { kind: FlashKind; text: string } {
  if (stats.reason === 'no-active-profile') {
    return { kind: 'err', text: 'Fetch now: no running search — create one on Settings → Profile.' };
  }
  const fetched = num(stats, 'fetched');
  const sources = num(stats, 'sources');
  const failed = num(stats, 'sourcesFailed');
  const took = formatDuration(num(stats, 'durationMs'));
  if (stats.reason === 'paused-mid-run') {
    return {
      kind: 'warn',
      text: `Fetch now stopped: fetching was paused mid-run after ${sources} sources (${fetched} jobs, nothing stored).`,
    };
  }
  if (fetched === 0) {
    return {
      kind: 'warn',
      text: `Fetch now: no jobs from ${sources} sources${failed > 0 ? ` (${failed} failed)` : ''} in ${took} — check the network, then the Quiet sources card on /companies.`,
    };
  }
  const persisted = num(stats, 'persisted');
  const head = `Fetch now: ${fetched} jobs from ${sources} sources${failed > 0 ? ` (${failed} failed)` : ''} in ${took} — ${persisted} new stored`;
  if (stats.classify === false) {
    return {
      kind: 'ok',
      text: `${head} unscored, no AI spent while the pipeline is paused. Score them later with Save & re-classify on Settings → Profile.`,
    };
  }
  if (stats.skippedBlankProfile === 1) {
    return {
      kind: 'warn',
      text: `Fetch now: ${fetched} jobs from ${sources} sources in ${took}, nothing stored — every running search is empty, so classification is idle.`,
    };
  }
  if (stats.abortedMidRun === 1) {
    return { kind: 'warn', text: `${head}; the rest was skipped when fetching was paused mid-run.` };
  }
  return { kind: 'ok', text: `${head}, ${num(stats, 'classified')} scored, ${num(stats, 'alerted')} alerted.` };
}
