/*
 * Activity lines for the "Fetch now" progress page (/runs/fetch-now/:id).
 * The fetch step reports live counts, so its line is data-driven; the store
 * step has no per-job signal and rotates on time like the compare page.
 * Pure — tested from src/web/fetch-run.test.ts; target-run.mjs polls.
 */
import { paced } from './target-run.mjs';
import { formatDecimal, t } from './i18n.mjs';

/** The store step's lines, as keys: worded when they show, in the page's language. */
const STORE_LINES = {
  unscored: ['browser.fetch.filtering', 'browser.fetch.duplicates', 'browser.fetch.storingUnscored'],
  scored: ['browser.fetch.filtering', 'browser.fetch.duplicates', 'browser.fetch.scoring', 'browser.fetch.alerting'],
};

function took(ms) {
  return ms < 1000 ? t('browser.duration.ms', { n: ms }) : t('browser.duration.seconds', { n: formatDecimal(ms / 1000, 1) });
}

/** "14 of 71 sources · 312 jobs so far · RemoteOK: 120 jobs in 1.2s" */
export function sourceLine(state) {
  if (state.sourcesTotal == null) return t('browser.fetch.contacting');
  const head = t('browser.fetch.progress', { done: state.sourcesDone, total: state.sourcesTotal, jobs: state.jobsFetched });
  const last = state.lastSource;
  if (!last) return head;
  const said = { name: last.name, result: last.failed ? 'failed' : last.count === 0 ? 'none' : 'jobs', n: last.count };
  const tail = last.durationMs == null ? t('browser.fetch.last', said) : t('browser.fetch.lastTimed', { ...said, took: took(last.durationMs) });
  return `${head} · ${tail}`;
}

export function fetchActivity(step, state) {
  if (step === 'fetch') return sourceLine(state);
  if (step === 'store') {
    return t(paced(state.classify ? STORE_LINES.scored : STORE_LINES.unscored, state.stageElapsedMs));
  }
  return '';
}
