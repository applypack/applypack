/*
 * Activity lines for the "Fetch now" progress page (/runs/fetch-now/:id).
 * The fetch step reports live counts, so its line is data-driven; the store
 * step has no per-job signal and rotates on time like the compare page.
 * Pure — tested from src/web/fetch-run.test.ts; target-run.mjs polls.
 */
import { paced } from './target-run.mjs';

const STORE_LINES = {
  unscored: [
    'Filtering against the active profile…',
    'Checking for duplicates and cross-listings…',
    'Storing the new postings unscored…',
  ],
  scored: [
    'Filtering against the active profile…',
    'Checking for duplicates and cross-listings…',
    'Scoring each new job with the AI — minutes for a big batch…',
    'Sending alerts for the matches…',
  ],
};

function jobs(n) {
  return `${n} job${n === 1 ? '' : 's'}`;
}

/** "14 of 71 sources · 312 jobs so far · RemoteOK: 120 jobs" */
export function sourceLine(state) {
  if (state.sourcesTotal == null) return 'Contacting the first source…';
  const last = state.lastSource;
  const tail = last
    ? ` · ${last.name}: ${last.failed ? 'failed' : last.count === 0 ? 'no jobs' : jobs(last.count)}`
    : '';
  return `${state.sourcesDone} of ${state.sourcesTotal} sources · ${jobs(state.jobsFetched)} so far${tail}`;
}

export function fetchActivity(step, state) {
  if (step === 'fetch') return sourceLine(state);
  if (step === 'store') {
    return paced(state.classify ? STORE_LINES.scored : STORE_LINES.unscored, state.stageElapsedMs);
  }
  return '';
}
