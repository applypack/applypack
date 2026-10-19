import type { CronStats } from '../jobs/cron-run';
import { FLASH_REASONS, filteredReasons, funnelCounts, reasonsText } from '../funnel';
import type { FlashKind } from './flash';
import { formatDuration } from './format';
import { t } from '../i18n/t';

/*
 * The one-line verdict of a finished "Fetch now" run, built from the
 * CronRun stats runFetchJob returns. Pure — tested in fetch-summary.test.ts.
 */

function num(stats: CronStats, key: string): number {
  const v = stats[key];
  return typeof v === 'number' ? v : 0;
}

/**
 * `label` opens every sentence: "Fetch now", or "Checked Acme" for the watchlist's Check now (TASKS S23).
 * `setup` is the wizard's test search: nobody paused anything there, and its last step does the scoring.
 */
export function summarizeFetchRun(stats: CronStats, label = t('fetch.fetchNow'), setup = false): { kind: FlashKind; text: string } {
  if (stats.reason === 'overlap') return { kind: 'warn', text: t('fetchSummary.overlap', { label }) };
  if (stats.reason === 'no-active-profile') return { kind: 'err', text: t('fetchSummary.noProfile', { label }) };
  // A walk with nothing switched on reached no board, so there is no network to blame (#557).
  if (stats.reason === 'no-sources') return { kind: 'warn', text: t('fetchSummary.noSources', { label }) };
  const fetched = num(stats, 'fetched');
  const sources = num(stats, 'sources');
  const failed = num(stats, 'sourcesFailed');
  const took = formatDuration(num(stats, 'durationMs'));
  if (stats.reason === 'paused-mid-run') return { kind: 'warn', text: t('fetchSummary.pausedMidRun', { label, sources, fetched }) };
  const unchanged = num(stats, 'sourcesUnchanged');
  if (fetched === 0) {
    // A source that answered "unchanged" proves the tick reached the boards,
    // so an empty run is the boards having nothing new — not a broken setup.
    if (unchanged > 0) {
      return { kind: 'ok', text: t(failed > 0 ? 'fetchSummary.nothingNewFailed' : 'fetchSummary.nothingNew', { label, took, unchanged, sources, failed }) };
    }
    return { kind: 'warn', text: t(failed > 0 ? 'fetchSummary.noJobsFailed' : 'fetchSummary.noJobs', { label, sources, failed, took }) };
  }
  // Each outcome is one whole sentence; what follows it (the filter's reasons, the way to score later) is a sentence of its own.
  const said = { label, fetched, sources, notes: sourceNotes(unchanged, failed), took, persisted: num(stats, 'persisted') };
  if (stats.classify === false) {
    return setup
      ? { kind: 'ok', text: `${t('fetchSummary.doneSetup', said)}${filteredClause(stats)} ${t('fetchSummary.scoreInSetup')}` }
      : { kind: 'ok', text: `${t('fetchSummary.doneUnscored', said)}${filteredClause(stats)} ${t('fetchSummary.scoreLater')}` };
  }
  if (stats.skippedBlankProfile === 1) return { kind: 'warn', text: t('fetchSummary.blank', { label, fetched, sources, took }) };
  if (stats.abortedMidRun === 1) return { kind: 'warn', text: t('fetchSummary.doneAborted', said) };
  return {
    kind: 'ok',
    text: `${t('fetchSummary.done', { ...said, classified: num(stats, 'classified'), alerted: num(stats, 'alerted') })}${filteredClause(stats)}`,
  };
}

/**
 * "Check now" on a change watch (#533). Such a page never yields a job, so
 * the shared summary's "no jobs — check the network" blamed the network for
 * a page that was read. This says whether it was read and what it found.
 * Null when the run did not get as far as the page — the shared summary
 * speaks for those.
 */
export function pageCheckLine(label: string, stats: CronStats): { kind: FlashKind; text: string } | null {
  const source = Array.isArray(stats.bySource) ? stats.bySource[0] : undefined;
  if (!source || typeof stats.reason === 'string') return null;
  if (source.status !== 'empty' && source.status !== 'not_modified') {
    return { kind: 'err', text: t('fetchSummary.page.notRead', { label, status: source.status }) };
  }
  if (num(stats, 'pageChangesFound') > 0) return { kind: 'ok', text: t('fetchSummary.page.changed', { label }) };
  if (num(stats, 'pageChangesHeld') > 0) return { kind: 'ok', text: t('fetchSummary.page.held', { label }) };
  if (num(stats, 'pagesFirstRead') > 0) return { kind: 'ok', text: t('fetchSummary.page.first', { label }) };
  return { kind: 'ok', text: t('fetchSummary.page.unchanged', { label }) };
}

/** " The filter set aside 500: 480 without a title keyword, 15 outside your places and 5 more." — its two largest gates (N2). */
function filteredClause(stats: CronStats): string {
  const total = num(stats, 'filterRejected');
  const why = reasonsText(filteredReasons(funnelCounts(stats)), { max: FLASH_REASONS, total });
  return why ? ` ${t('fetchSummary.filtered', { n: total, why })}` : '';
}

/** " (44 unchanged, 2 failed)" — whichever of the two happened, with the space that sets it off. */
function sourceNotes(unchanged: number, failed: number): string {
  if (unchanged > 0 && failed > 0) return ` ${t('fetchSummary.notes.both', { unchanged, failed })}`;
  if (unchanged > 0) return ` ${t('fetchSummary.notes.unchanged', { unchanged })}`;
  return failed > 0 ? ` ${t('fetchSummary.notes.failed', { failed })}` : '';
}
