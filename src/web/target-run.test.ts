import { test } from 'node:test';
import assert from 'node:assert/strict';

// The progress driver ships as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const page = import('./public/target-run.mjs') as Promise<{
  activityFor: (step: string, stageElapsedMs: number) => string;
  formatElapsed: (ms: number) => string;
  progressLine: (step: string, progress: { done: number; total: number }) => string;
  stepTime: (stepState: string, step: string, state: Record<string, unknown>) => string;
  init: unknown;
}>;

test('activityFor advances with stage time and holds on the last line', async () => {
  const { activityFor } = await page;
  const first = activityFor('match', 0);
  const second = activityFor('match', 9_500);
  assert.notEqual(first, '');
  assert.notEqual(first, second);
  const last = activityFor('match', 10 * 60_000);
  assert.equal(activityFor('match', 20 * 60_000), last, 'holds on the final line');
  assert.notEqual(activityFor('extract', 0), '', 'the detect step narrates too');
  assert.notEqual(activityFor('letter', 0), '', 'the cover-letter step narrates too');
  assert.notEqual(activityFor('keywords', 0), '', 'the quick check narrates too');
  assert.notEqual(activityFor('suggestions', 0), '', 'the suggestions step narrates too');
  assert.equal(activityFor('nope', 0), '', 'unknown step yields nothing');
});

test('formatElapsed switches to minutes past 60 s', async () => {
  const { formatElapsed } = await page;
  assert.equal(formatElapsed(4_000), '4s');
  assert.equal(formatElapsed(76_000), '1m 16s');
});

test('target-run module imports without a DOM and exposes init', async () => {
  assert.equal(typeof (await page).init, 'function');
});

test('progressLine names the unit per step', async () => {
  const { progressLine, activityFor } = await page;
  assert.equal(progressLine('score', { done: 12, total: 100 }), '12 of 100 jobs scored');
  assert.equal(progressLine('nope', { done: 1, total: 2 }), '1 of 2 done');
  assert.notEqual(activityFor('score', 0), '', 'the score step narrates before counts arrive');
});

test('stepTime counts the active step live and freezes finished ones', async () => {
  const { stepTime } = await page;
  const state = { stageElapsedMs: 4_000, stepMs: { scan: 76_000 } };
  assert.equal(stepTime('active', 'match', state), '4s');
  assert.equal(stepTime('done', 'scan', state), '1m 16s');
  assert.equal(stepTime('done', 'extract', state), '', 'no recorded time, no number');
  assert.equal(stepTime('pending', 'match', state), '');
  assert.equal(stepTime('done', 'scan', { stageElapsedMs: 0 }), '', 'a registry without stepMs (fetch page)');
});
