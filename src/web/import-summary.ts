import type { CronStats } from '../jobs/cron-run';
import { filteredReasons, funnelCounts, reasonsText } from '../funnel';
import type { FlashKind } from './flash';

/*
 * The verdict of a finished import as one flash, built from the stats
 * `runImportJob` returns. Pure — tested in import-summary.test.ts.
 */

function num(stats: CronStats, key: string): number {
  const v = stats[key];
  return typeof v === 'number' ? v : 0;
}

const rows = (n: number): string => `${n.toLocaleString('en-US')} row${n === 1 ? '' : 's'}`;

export function summarizeImport(stats: CronStats, fileName: string, source: string): { kind: FlashKind; text: string } {
  if (stats.reason === 'overlap') {
    return {
      kind: 'warn',
      text: 'Nothing was imported: a fetch is running (the hourly one, or Fetch now), and two at once would score the same postings twice. Its row on Runs shows when it is done; then press Import again.',
    };
  }
  if (stats.reason === 'no-active-profile') {
    return { kind: 'err', text: 'Nothing was imported: no search is running. Switch one on under Settings → Searches, then import again.' };
  }
  const fetched = num(stats, 'fetched');
  if (stats.skippedBlankProfile === 1) {
    return {
      kind: 'warn',
      text: `Nothing was stored from ${fileName}: every running search is empty, so nothing is scored. Give one a required stack or role types on Settings → Searches, then import again.`,
    };
  }
  const stored = num(stats, 'persisted');
  const known = num(stats, 'duplicate');
  const why = reasonsText(filteredReasons(funnelCounts(stats)), 2);
  const tail = `${known > 0 ? ` ${rows(known)} ${known === 1 ? 'was' : 'were'} already stored.` : ''}${why ? ` The filter set aside ${num(stats, 'filterRejected')}: ${why}.` : ''}`;
  const head = `Imported ${fileName} into "${source}": ${rows(fetched)}, ${stored} new stored`;
  if (stats.classify === false) {
    return {
      kind: 'ok',
      text: `${head} unscored — no AI spent while fetching is paused.${tail}${stored > 0 ? ' Score them later with Save & re-classify on Settings → Searches.' : ''}`,
    };
  }
  if (stats.abortedMidRun === 1) {
    return { kind: 'warn', text: `${head}; the rest was skipped when fetching was paused mid-run.${tail} Import the file again to add what is left.` };
  }
  const failed = num(stats, 'classifyFailed');
  const scored = `${head}, ${num(stats, 'classified')} scored, ${num(stats, 'alerted')} alerted.${tail}`;
  if (failed > 0) {
    return { kind: 'warn', text: `${scored} ${rows(failed)} could not be scored — the AI engine failed — and ${failed === 1 ? 'was' : 'were'} not stored; import the file again to retry.` };
  }
  return { kind: 'ok', text: scored };
}
