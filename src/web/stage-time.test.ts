import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageTimeLine, type StageTimeEvent } from './stage-time';

const NOW = new Date('2026-09-01T12:00:00Z');

const daysAgo = (n: number): Date =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const ev = (
  toStage: string,
  occurredDaysAgo: number,
  source = 'ui',
  recordedDaysAgo = occurredDaysAgo,
): StageTimeEvent => ({
  toStage,
  occurredOn: daysAgo(occurredDaysAgo),
  recordedAt: daysAgo(recordedDaysAgo),
  source,
});

test('no events and no appliedAt gives no line', () => {
  assert.equal(stageTimeLine('screen', null, [], NOW), null);
});

test('applied stage falls back to appliedAt', () => {
  const line = stageTimeLine('applied', daysAgo(12), [], NOW);
  assert.deepEqual(line, { text: 'applied 12d ago', stale: false, since: daysAgo(12) });
});

test('applied stage goes stale past 14 days', () => {
  const line = stageTimeLine('applied', daysAgo(20), [], NOW);
  assert.equal(line?.text, 'applied 20d ago · stalled');
  assert.equal(line?.stale, true);
});

test('exactly 14 days is not yet stale', () => {
  const line = stageTimeLine('screen', null, [ev('screen', 14)], NOW);
  assert.equal(line?.text, 'in screen 14d');
  assert.equal(line?.stale, false);
});

test('ranked stage dated by its ledger event', () => {
  const line = stageTimeLine('screen', daysAgo(30), [ev('screen', 5)], NOW);
  assert.deepEqual(line, { text: 'in screen 5d', stale: false, since: daysAgo(5) });
});

test('ranked stage goes stale past 14 days', () => {
  const line = stageTimeLine('tech', null, [ev('tech', 15)], NOW);
  assert.equal(line?.text, 'in tech 15d · stalled');
  assert.equal(line?.stale, true);
});

test('backfill events never date a stage — appliedAt fallback, not stale', () => {
  const line = stageTimeLine('screen', daysAgo(30), [ev('screen', 30, 'backfill')], NOW);
  assert.equal(line?.text, 'applied 30d ago');
  assert.equal(line?.stale, false);
});

test('backfill-only history with no appliedAt gives no line', () => {
  assert.equal(stageTimeLine('screen', null, [ev('screen', 30, 'backfill')], NOW), null);
});

test('terminal stage reads past tense and is never stale', () => {
  const line = stageTimeLine('rejected', daysAgo(40), [ev('rejected', 20)], NOW);
  assert.equal(line?.text, 'rejected 20d ago');
  assert.equal(line?.stale, false);
});

test('latest event into the stage wins on re-entry', () => {
  const line = stageTimeLine(
    'screen',
    null,
    [ev('screen', 40, 'ui', 40), ev('tech', 30, 'ui', 30), ev('screen', 3, 'ui', 3)],
    NOW,
  );
  assert.equal(line?.text, 'in screen 3d');
});

test('a correction event re-dates the applied stage', () => {
  const line = stageTimeLine(
    'applied',
    daysAgo(2),
    [ev('applied', 2, 'ui', 2), ev('applied', 10, 'correction', 1)],
    NOW,
  );
  assert.equal(line?.text, 'applied 10d ago');
});

test('events into other stages are ignored', () => {
  const line = stageTimeLine('screen', daysAgo(8), [ev('applied', 8)], NOW);
  assert.equal(line?.text, 'applied 8d ago');
  assert.equal(line?.stale, false);
});

test('same-day entry says today', () => {
  assert.equal(stageTimeLine('applied', daysAgo(0), [], NOW)?.text, 'applied today');
  assert.equal(stageTimeLine('screen', null, [ev('screen', 0)], NOW)?.text, 'in screen today');
  assert.equal(stageTimeLine('ghosted', null, [ev('ghosted', 0)], NOW)?.text, 'ghosted today');
});

test('a custom label replaces the key in the text', () => {
  const line = stageTimeLine('hr-call', null, [ev('hr-call', 5)], NOW, 'HR Call');
  assert.equal(line?.text, 'in hr call 5d');
});

test('a future since-day clamps to zero days', () => {
  const line = stageTimeLine('applied', daysAgo(-3), [], NOW);
  assert.equal(line?.text, 'applied today');
});
