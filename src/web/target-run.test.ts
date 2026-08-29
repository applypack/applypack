import { test } from 'node:test';
import assert from 'node:assert/strict';

// The progress driver ships as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const page = import('./public/target-run.mjs') as Promise<{
  activityFor: (step: string, stageElapsedMs: number) => string;
  formatElapsed: (ms: number) => string;
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
