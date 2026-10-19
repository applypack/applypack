import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addCounts, FUNNEL_KEYS, funnelCounts, funnelView, readCounts, reasonsText, runCounts, scorePassCounts, stageCount, sumDays, utcDay } from './funnel';

test('a run gives the funnel its counts and nothing else', () => {
  assert.deepEqual(
    funnelCounts({ fetched: 540, filterRejected: 500, rejectedTitle: 480, durationMs: 90_000, skipped: 1, profile: 'QA', matched: 0, bySource: [] }),
    { fetched: 540, filterRejected: 500, rejectedTitle: 480 },
  );
});

test('a run cut short adds only what it delivered', () => {
  // Paused after the walk: 540 read, none judged. Counting them would put all 540 past the filter.
  assert.deepEqual(runCounts({ fetched: 540, aborted: 1, reason: 'paused-mid-run', heldDelivered: 2 }), { heldDelivered: 2 });
  // Paused inside the loop, or every running search blank: the same.
  assert.deepEqual(runCounts({ fetched: 540, filterRejected: 90, alerted: 1, abortedMidRun: 1 }), { alerted: 1 });
  assert.deepEqual(runCounts({ fetched: 540, skippedBlankProfile: 1 }), {});
  // A whole run counts whole.
  assert.deepEqual(runCounts({ fetched: 540, filterRejected: 500, abortedMidRun: 0 }), { fetched: 540, filterRejected: 500 });
});

test('days add up key by key, and a stored day that is not counts reads as nothing', () => {
  assert.deepEqual(addCounts({ fetched: 10, matched: 1 }, { fetched: 5, alerted: 1 }), { fetched: 15, matched: 1, alerted: 1 });
  assert.deepEqual(readCounts('nonsense'), {});
  assert.deepEqual(readCounts({ fetched: 3, notAKey: 9 }), { fetched: 3 });
});

test('the stages read left to right, with the reasons largest first', () => {
  const view = funnelView({
    fetched: 5432,
    filterRejected: 5120,
    rejectedTitle: 4900,
    rejectedPlace: 150,
    rejectedExcluded: 70,
    duplicate: 250,
    classified: 60,
    preFiltered: 2,
    dismissed: 44,
    dismissedLowFit: 40,
    dismissedLocation: 4,
    matched: 18,
    alerted: 5,
    heldDelivered: 2,
  });
  assert.deepEqual(view.stages.map((s) => s.count), [5432, 312, 62, 62, 18, 7]);
  assert.deepEqual(view.filtered, [
    { label: 'without a title keyword', count: 4900 },
    { label: 'outside your places', count: 150 },
    { label: 'with an excluded word in the title', count: 70 },
  ]);
  assert.deepEqual(view.dismissed, [
    { label: 'under the fit threshold', count: 40 },
    { label: 'with a location mismatch', count: 4 },
  ]);
  assert.equal(reasonsText(view.filtered, 2), '4,900 without a title keyword, 150 outside your places');
});

test('a total the reasons do not cover ends on the rest, which predates them', () => {
  // A day backfilled from the runs stored before this release has the totals only.
  const view = funnelView({ filterRejected: 900, rejectedTitle: 100, dismissed: 30 });
  assert.deepEqual(view.filtered, [
    { label: 'without a title keyword', count: 100 },
    { label: 'from before the reasons were counted', count: 800 },
  ]);
  assert.deepEqual(view.dismissed, [{ label: 'from before the reasons were counted', count: 30 }]);
  // A re-score carries reasons and no total: nothing is invented for it.
  assert.deepEqual(funnelView({ dismissedLowFit: 6 }).dismissed, [{ label: 'under the fit threshold', count: 6 }]);
});

test('an empty week is all zeros, never negative', () => {
  assert.deepEqual(funnelView({}).stages.map((s) => s.count), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(funnelView({ fetched: 10, filterRejected: 12 }).stages[1], { key: 'passed', label: 'Past the filter', count: 0 });
  assert.equal(stageCount(funnelView({ matched: 3 }), 'matches'), 3);
});

test('a window counts today and the days before it, by UTC day', () => {
  const now = new Date('2026-09-28T03:00:00Z');
  assert.equal(utcDay(new Date('2026-09-27T23:59:59Z')).toISOString(), '2026-09-27T00:00:00.000Z');
  const rows = [
    { day: new Date('2026-09-28T00:00:00Z'), counts: { fetched: 1 } },
    { day: new Date('2026-09-22T00:00:00Z'), counts: { fetched: 10 } },
    { day: new Date('2026-09-21T00:00:00Z'), counts: { fetched: 100 } },
  ];
  assert.deepEqual(sumDays(rows, 7, now), { fetched: 11 });
  assert.deepEqual(sumDays(rows, 30, now), { fetched: 111 });
});

/** Counters that began after funnel_day's backfill ran; the runs before them never wrote one. */
const COUNTED_SINCE_BACKFILL = ['rejectedMuted', 'rejectedApplied'];

test('the backfill reads the same counters the ticks write', () => {
  // The migration that created funnel_day summed the stored runs with its own copy of the list.
  const sql = readFileSync('prisma/migrations/20260928120000_funnel_day/migration.sql', 'utf8');
  const list = /kv\."key" IN \(([^)]*)\)/.exec(sql)?.[1] ?? '';
  assert.deepEqual(
    [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]),
    FUNNEL_KEYS.filter((k) => !COUNTED_SINCE_BACKFILL.includes(k)),
  );
});

test("the first scoring of stored postings counts what it found and what the filled-in search turned away", () => {
  // The wizard's pass on a fresh install (2026-10-18): 10 scored, 2 kept, 453 off-topic for free.
  const stats = { scanned: 10, reclassified: 10, matched: 2, unchanged: 2, demoted: 8, dismissedLowFit: 8, failed: 0, filterDismissed: 453, rejectedTitle: 453, remaining: 48, concurrency: 3 };
  assert.deepEqual(scorePassCounts(stats), { classified: 10, matched: 2, dismissed: 8, filterRejected: 453, rejectedTitle: 453, dismissedLowFit: 8 });
  const day = funnelView(addCounts({ fetched: 617, filterRejected: 105, duplicate: 1 }, scorePassCounts(stats)));
  assert.deepEqual(day.stages.map((s) => s.count), [617, 59, 58, 10, 2, 0]);
});
