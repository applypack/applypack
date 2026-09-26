import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRun } from './runs-summary';

describe('summarizeRun', () => {
  it('reads a fetch tick as its facts, in a fixed order', () => {
    const stats = {
      alerted: 0,
      sources: 9,
      classified: 3,
      duplicate: 55,
      persisted: 3,
      fetched: 594,
      crossListed: 0,
      durationMs: 22_619,
      profile: 'Senior Software Engineer',
      bySource: [{ name: 'Remotive', status: 'ok', count: 40, ms: 900 }],
    };
    assert.deepEqual(summarizeRun('fetch', stats), ['594 fetched', '3 new', '55 duplicates', '3 classified', '0 alerted']);
  });

  it('an uneventful tick says so in two facts', () => {
    assert.deepEqual(summarizeRun('fetch', { fetched: 25, persisted: 0, duplicate: 0, classified: 0, alerted: 0, sources: 2 }), [
      '25 fetched',
      '0 new',
    ]);
  });

  it('counts speak in the singular, and thousands carry a separator', () => {
    assert.deepEqual(summarizeRun('fetch', { fetched: 1204, persisted: 1, duplicate: 1, alerted: 1, sourcesFailed: 1 }), [
      '1,204 fetched',
      '1 new',
      '1 duplicate',
      '1 alerted',
      '1 source failed',
    ]);
  });

  it('turns a reason into a sentence', () => {
    assert.deepEqual(summarizeRun('discovery', { skipped: 1, reason: 'discovery-disabled' }), ['Discovery is switched off']);
    assert.deepEqual(summarizeRun('fetch', { skipped: 1, reason: 'fetching-paused' }), ['Fetching is paused']);
    assert.deepEqual(summarizeRun('hn-hiring', { aborted: 1, reason: 'no-active-profile' }), ['No running search']);
    assert.deepEqual(summarizeRun('x', { reason: 'something-new' }), ['Skipped: something new']);
  });

  it('keeps the facts after a mid-run pause', () => {
    assert.deepEqual(summarizeRun('fetch-now', { reason: 'paused-mid-run', fetched: 120, sources: 3 }), [
      'Fetching was paused mid-run; nothing stored',
      '120 fetched',
    ]);
  });

  it('words a bare count for the job that writes it, and humanises it for any other', () => {
    assert.deepEqual(summarizeRun('digest', { count: 3, durationMs: 527 }), ['3 jobs in the digest']);
    assert.deepEqual(summarizeRun('stale-applications', { found: 0 }), ['0 stale applications']);
    assert.deepEqual(
      summarizeRun('cleanup', { deleted: 12, screeningsDeleted: 1, runsDeleted: 240, durationMs: 40 }),
      ['12 old jobs deleted', '1 screening deleted', '240 old runs deleted'],
    );
    assert.deepEqual(summarizeRun('some-new-job', { count: 3 }), ['3 count']);
  });

  it('humanises a count it has never heard of and leaves zeros and non-numbers to the raw block', () => {
    assert.deepEqual(summarizeRun('fetch', { fetched: 10, persisted: 0, priorityBoosted: 2, watchedKept: 0, classify: false, classifierMode: 'single' }), [
      '10 fetched',
      '0 new',
      '2 priority boosted',
    ]);
  });

  it('leaves the routine counters to the raw block and says a raised flag as a sentence', () => {
    assert.deepEqual(summarizeRun('fetch', { fetched: 567, persisted: 2, classified: 2, alerted: 0, dismissed: 2, filterRejected: 517, preFiltered: 3 }), [
      '567 fetched',
      '2 new',
      '2 classified',
      '0 alerted',
    ]);
    assert.deepEqual(summarizeRun('fetch', { fetched: 40, persisted: 0, skippedBlankProfile: 1, abortedMidRun: 0, alertFailed: 2 }), [
      'Every running search is empty; nothing scored',
      '40 fetched',
      '0 new',
      '2 alerts failed to send',
    ]);
  });

  it('says which switch stopped the monthly HN pull', () => {
    assert.deepEqual(summarizeRun('hn-hiring', { skipped: 1, reason: 'source-disabled' }), ['The source is switched off on Settings → Sources']);
  });

  it('has nothing to say about an empty record', () => {
    assert.deepEqual(summarizeRun('fetch', {}), []);
  });
});
