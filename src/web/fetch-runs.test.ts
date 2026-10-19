import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeFetchRun, createFetchRun, fetchRunBackLabel, fetchRunSubtitle, getFetchRun, updateFetchRun } from './fetch-runs';

/*
 * How long "Fetch now" remembers a run (#407). The registry is one per
 * process, so every test ends with no run at work.
 */

const fields = { classify: true, backUrl: '/runs', scope: 'every' } as const;
const MIN = 60_000;

/** A run that starts and ends at once: creating one is what prunes. */
function nextPress(): void {
  updateFetchRun(createFetchRun(fields).id, { stage: 'done', stats: {} });
}

test('a long run keeps its verdict for half an hour after it finished, not after it started', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  const run = createFetchRun(fields);
  t.mock.timers.tick(40 * MIN);
  assert.equal(activeFetchRun()?.id, run.id);
  updateFetchRun(run.id, { stage: 'done', stats: { persisted: 12 } });

  t.mock.timers.tick(MIN);
  nextPress();
  assert.deepEqual(getFetchRun(run.id)?.stats, { persisted: 12 });

  t.mock.timers.tick(28 * MIN);
  nextPress();
  assert.equal(getFetchRun(run.id)?.stage, 'done');

  t.mock.timers.tick(2 * MIN);
  nextPress();
  assert.equal(getFetchRun(run.id), null);
});

test('a run that never returns stops holding the guard, and the next press drops it', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 9_000_000 });
  const hung = createFetchRun(fields);
  t.mock.timers.tick(5 * 60 * MIN);
  assert.equal(activeFetchRun()?.id, hung.id);

  t.mock.timers.tick(61 * MIN);
  assert.equal(activeFetchRun(), null);
  nextPress();
  assert.equal(getFetchRun(hung.id), null);
});

test('a run that failed is kept as a finished one is', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 13_000_000 });
  const run = createFetchRun(fields);
  t.mock.timers.tick(45 * MIN);
  updateFetchRun(run.id, { stage: 'error' });
  t.mock.timers.tick(10 * MIN);
  nextPress();
  assert.equal(getFetchRun(run.id)?.stage, 'error');
});

test('a Check now speaks of its one source, and a failed run goes back the way it came (#606)', () => {
  const one = { companyId: 7, name: 'Acme' };
  assert.equal(fetchRunSubtitle({ classify: true, scope: one, backUrl: '/companies' }), 'fetch.oneSourceThenThe');
  assert.equal(fetchRunSubtitle({ classify: false, scope: { ...one, folder: true }, backUrl: '/companies/7/files' }), 'fetch.oneSourceNewJobs');
  assert.equal(fetchRunSubtitle({ classify: true, scope: 'every', backUrl: '/runs' }), 'fetch.everyEnabledSourceThenThe');
  assert.equal(fetchRunSubtitle({ classify: false, scope: 'every', backUrl: '/runs' }), 'fetch.everyEnabledSourceNewJobs');
  assert.equal(fetchRunSubtitle({ classify: false, scope: 'aggregators', backUrl: '/welcome' }), 'fetch.setupSearchSubtitle');

  assert.equal(fetchRunBackLabel('/runs'), 'fetch.backToRuns');
  assert.equal(fetchRunBackLabel('/welcome'), 'fetch.backToSetup');
  assert.equal(fetchRunBackLabel('/companies'), 'fetch.backToCompanies');
  assert.equal(fetchRunBackLabel('/companies/7/files'), 'fetch.backToFiles');
});
