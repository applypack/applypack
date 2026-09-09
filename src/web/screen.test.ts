import { test } from 'node:test';
import assert from 'node:assert/strict';

// The page module ships as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const page = import('./public/screen.mjs') as Promise<{
  progressLine: (state: { done: number; failed: number; total: number }) => string;
  init: unknown;
}>;

test('screen.mjs: progressLine', async () => {
  const { progressLine } = await page;
  assert.equal(progressLine({ done: 12, failed: 0, total: 40 }), 'Scoring… 12 of 40 — one call per applicant, three at a time; the page updates itself.');
  assert.match(progressLine({ done: 10, failed: 2, total: 40 }), /12 of 40 \(2 failed\)/);
});
