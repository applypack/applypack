import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { failedRunLine, summarizeRun, unscoredRun } from './runs-summary';

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

  it('names the matches, and leaves the filter and dismissal reasons to the funnel card', () => {
    const stats = {
      fetched: 540,
      filterRejected: 500,
      rejectedTitle: 480,
      rejectedPlace: 20,
      persisted: 40,
      classified: 40,
      dismissed: 38,
      dismissedLowFit: 30,
      dismissedLocation: 8,
      matched: 2,
      alerted: 2,
    };
    assert.deepEqual(summarizeRun('fetch', stats), ['540 fetched', '40 new', '40 classified', '2 matches', '2 alerted']);
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
    // #557: a tick that read no source says why, before its zeros.
    assert.deepEqual(summarizeRun('fetch', { reason: 'none-due', fetched: 0, persisted: 0, sources: 0 }), [
      'No source was due yet: each waits for its own check interval',
      '0 fetched',
      '0 new',
    ]);
    assert.match(summarizeRun('fetch-now', { reason: 'no-sources', fetched: 0 })[0] ?? '', /^No source to read/);
  });

  it('a discovery run leads with what is left for review, the count /discovery shows (#542)', () => {
    assert.deepEqual(summarizeRun('discovery', { pending: 31, probed: 28, alive: 27, dead: 1, jobsCountUpdated: 0, durationMs: 40_000 }), [
      '31 pending review',
      '28 probed',
      '27 alive',
      '1 dead',
    ]);
    // Another job's "pending" is not a review list.
    assert.deepEqual(summarizeRun('x', { pending: 2 }), ['2 pending']);
  });

  it('keeps the facts after a mid-run pause', () => {
    assert.deepEqual(summarizeRun('fetch-now', { reason: 'paused-mid-run', fetched: 120, sources: 3 }), [
      'Fetching was paused mid-run; nothing stored',
      '120 fetched',
    ]);
  });

  it('words a pack run in the catalog: its counts are bare words another job would mean differently', () => {
    // Found in CI: a pack the worker took mid-smoke wrote "1 failed" on /runs, English in every language.
    assert.deepEqual(summarizeRun('pack', { ready: 2, stopped: 1, failed: 1, requeued: 1, notified: 3 }), [
      '2 packs ready',
      '1 pack stopped before the edits',
      '1 pack failed',
      '1 pack put back in the queue',
      '3 packs announced',
    ]);
    assert.deepEqual(summarizeRun('pack', { ready: 0, stopped: 0, failed: 0, requeued: 0, notified: 0 }), []);
    // A pack the tick queued and nobody wanted by the time the runner took it.
    assert.deepEqual(summarizeRun('pack', { ready: 0, stopped: 0, failed: 0, requeued: 0, dropped: 3, notified: 0 }), ['3 packs no longer wanted, taken out of the queue']);
    assert.deepEqual(summarizeRun('pack', { ready: 0, stopped: 0, failed: 0, requeued: 0, notified: 0, reason: 'overlap' }), [
      'Another run was preparing packs; this one did nothing',
    ]);
    assert.deepEqual(summarizeRun('fetch', { reason: 'overlap' }), ['Another fetch was running; this one did nothing']);
    // The tick that queued them agrees in number ("1 packs queued" before).
    assert.ok(summarizeRun('fetch', { fetched: 10, persisted: 1, packsQueued: 1 }).includes('1 pack queued'));
    assert.ok(summarizeRun('import', { fetched: 10, persisted: 2, packsQueued: 2 }).includes('2 packs queued'));
    // Another job's "failed" is still its own word.
    assert.deepEqual(summarizeRun('reclassify-all', { failed: 2 }), ['2 could not be scored']);
  });

  it("says what a scoring pass found, not its machinery", () => {
    // The wizard's first scoring on a fresh install (2026-10-18) read "8 demoted · 10 scanned · 511 unscored · 2 unchanged · 3 concurrency".
    const stats = { scanned: 10, reclassified: 10, matched: 2, unchanged: 2, demoted: 8, dismissedLowFit: 8, failed: 0, filterDismissed: 453, rejectedTitle: 453, remaining: 48, unscored: 511, concurrency: 3, durationMs: 22_300 };
    assert.deepEqual(summarizeRun('score-unscored', stats), ['10 scored', '2 matches', '8 moved to Dismissed', '453 set aside by the filter, no AI', '48 still waiting to be scored']);
  });

  it('words a bare count for the job that writes it, and humanises it for any other', () => {
    assert.deepEqual(summarizeRun('digest', { count: 3, durationMs: 527 }), ['3 jobs in the digest']);
    // Rows found while paused are said apart from the matches, and only when there were some (#392).
    assert.deepEqual(summarizeRun('digest', { count: 2, unscored: 40, durationMs: 14 }), ['2 jobs in the digest', '40 new jobs without a score']);
    assert.deepEqual(summarizeRun('digest', { count: 2, unscored: 0, durationMs: 14 }), ['2 jobs in the digest']);
    assert.deepEqual(summarizeRun('stale-applications', { found: 0 }), ['0 stale applications']);
    assert.deepEqual(
      summarizeRun('cleanup', { deleted: 12, screeningsDeleted: 1, runsDeleted: 240, durationMs: 40 }),
      ['12 old jobs deleted', '1 screening deleted', '240 old runs deleted'],
    );
    // #474: the keys of deleted dismissals, forgotten once they are kept no longer.
    assert.deepEqual(summarizeRun('cleanup', { deleted: 0, dismissalsForgotten: 3, durationMs: 40 }), ['0 old jobs deleted', '3 dismissed postings forgotten']);
    assert.deepEqual(summarizeRun('cleanup', { deleted: 4, dismissalsForgotten: 0 }), ['4 old jobs deleted']);
    assert.deepEqual(summarizeRun('some-new-job', { count: 3 }), ['3 count']);
  });

  it('humanises a count it has never heard of and leaves zeros and non-numbers to the raw block', () => {
    assert.deepEqual(summarizeRun('fetch', { fetched: 10, persisted: 0, rowsTrimmed: 2, watchedKept: 0, classify: false, classifierMode: 'single' }), [
      '10 fetched',
      '0 new',
      '2 rows trimmed',
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
      '2 alerts failed to send, held for a retry',
    ]);
  });

  it('says why a match was not sent: the window, the switch, no chat', () => {
    assert.deepEqual(summarizeRun('fetch', { fetched: 9, persisted: 4, alerted: 0, alertHeld: 1, alertsOffHeld: 2, alertNoTarget: 1 }), [
      '9 fetched',
      '4 new',
      '0 alerted',
      '1 held for the alert window',
      '2 held while Alerts are off',
      '1 not alerted: no chat set up',
    ]);
  });

  it('names the reason a recap or a nudge went nowhere', () => {
    assert.deepEqual(summarizeRun('digest', { skipped: 1, reason: 'alerts-off', durationMs: 12 }), ['Alerts are switched off; nothing sent']);
    assert.deepEqual(summarizeRun('stale-applications', { skipped: 1, reason: 'no-targets', found: 3 }), [
      'No chat to send to',
      '3 stale applications',
    ]);
  });

  it('says which switch stopped the monthly HN pull', () => {
    assert.deepEqual(summarizeRun('hn-hiring', { skipped: 1, reason: 'source-disabled' }), ['The source is switched off on Settings → Sources']);
  });

  it('says a tick met another fetch and stood down', () => {
    assert.deepEqual(summarizeRun('fetch', { skipped: 1, reason: 'overlap' }), ['Another fetch was running; this one did nothing']);
  });

  it('says a match from a folder with its alerts off in words, not as a humanised counter (#365)', () => {
    const stats = { fetched: 3, persisted: 1, classified: 1, matched: 1, alertSourceOff: 1 };
    // Worded for any source since an import can be stored with no alerts too (#402).
    assert.deepEqual(summarizeRun('fetch', stats), ['3 fetched', '1 new', '1 classified', '1 match', '1 not alerted: alerts are off for its source']);
    assert.equal(summarizeRun('folder-watch', { ...stats, alertSourceOff: 2 }).at(-1), '2 not alerted: alerts are off for their source');
    // An import's one message lists the best and counts the rest.
    assert.deepEqual(summarizeRun('import', { fetched: 300, persisted: 300, classified: 300, matched: 300, alerted: 20, alertCounted: 280 }).slice(-2), ['20 alerted', '280 more counted in the message']);
  });

  it('has nothing to say about an empty record', () => {
    assert.deepEqual(summarizeRun('fetch', {}), []);
  });

  it('reads an import in its own words: jobs of a file, not a fetch', () => {
    // The count is the rows that are jobs (import-job.ts): a row with no title and a repeat are not among them,
    // so "rows read from the file" named a number the preview had called something else (#404).
    const stats = { source: 'September export', fetched: 250, persisted: 37, duplicate: 112, classified: 37, alerted: 4, filterRejected: 101, rejectedTitle: 101, durationMs: 9_000 };
    assert.deepEqual(summarizeRun('import', stats), ['250 jobs in the file', '37 new', '112 duplicates', '37 classified', '4 alerted']);
    assert.deepEqual(summarizeRun('import', { fetched: 1, persisted: 0 }), ['1 job in the file', '0 new']);
    assert.deepEqual(summarizeRun('import', { skipped: 1, reason: 'overlap' }), ['Another fetch was running; this one did nothing']);
    // The shared wording stands for every other job.
    assert.equal(summarizeRun('fetch', { fetched: 250 })[0], '250 fetched');
  });
});

describe('failedRunLine (TASKS U6)', () => {
  it('says what failed, why in one line, and what comes next', () => {
    assert.equal(
      failedRunLine('fetch', 'PrismaClientKnownRequestError: connection refused.\n    at Object.request (node_modules/...)'),
      'The fetch run failed: PrismaClientKnownRequestError: connection refused. What it stored before the failure stays, and the next tick tries again.',
    );
    assert.equal(failedRunLine('digest', 'Telegram 401 Unauthorized'), 'The digest run failed: Telegram 401 Unauthorized. Nothing was sent; the next digest hour tries again.');
  });
  it('a failed import says the file can be imported again', () => {
    assert.equal(
      failedRunLine('import', 'connection refused'),
      'The import run failed: connection refused. What it stored before the failure stays; import the same file again and only the rest is added.',
    );
  });
  it('an unknown job still gets a way forward, and an empty error points at the log', () => {
    assert.equal(failedRunLine('reclassify', ''), 'The reclassify run failed. The next scheduled run tries again. The web log has the detail.');
  });
  it('a long reason is cut to one sentence', () => {
    assert.ok(failedRunLine('cleanup', 'x'.repeat(400)).includes('…'));
  });
});

// #366: a run that scored nothing it tried to finished "OK", and a dead engine stayed green for a night.
it('a run that scored nothing it tried to is not an OK to the reader', () => {
  // The line the issue quotes: "1 fetched · 0 new · 1 failed to classify".
  assert.equal(unscoredRun('OK', { fetched: 1, persisted: 0, classifyFailed: 1, classified: 0 }), true);
  assert.equal(unscoredRun('OK', { fetched: 40, classifyFailed: 12 }), true);
  // Some were scored, or the prefilter answered: the engine works, and the count says the rest.
  assert.equal(unscoredRun('OK', { classifyFailed: 2, classified: 9 }), false);
  assert.equal(unscoredRun('OK', { classifyFailed: 1, classified: 0, preFiltered: 5 }), false);
  // Nothing reached the classifier: an uneventful tick, a pause, a run of another kind.
  assert.equal(unscoredRun('OK', { fetched: 30, persisted: 0, classifyFailed: 0 }), false);
  assert.equal(unscoredRun('OK', { deleted: 3 }), false);
  assert.equal(unscoredRun('OK', null), false);
  assert.equal(unscoredRun('OK', 'not stats'), false);
  // A run that failed or is still running says so itself.
  assert.equal(unscoredRun('FAILED', { classifyFailed: 3 }), false);
  assert.equal(unscoredRun('RUNNING', { classifyFailed: 3 }), false);
});
