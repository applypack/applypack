import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitTone } from './format';

/*
 * The score's tone is decided in two places by necessity — the server's
 * format.ts for every rendered badge, the browser's target-page.mjs for the
 * ring that moves as the user types — and used to be four (the same
 * cut-offs typed out again in target.tsx and DESIGN.md). This holds the two
 * that must exist equal on every score (audit 2026-09-10, COPY-4), the way
 * score.test.ts holds score.mjs to score.ts.
 */
test('the ring paints the tone format.ts:fitTone names, on every score', async () => {
  // @ts-expect-error — plain JS with no declaration file.
  const { ringTone } = (await import('./public/target-page.mjs')) as { ringTone: (score: number) => string };
  for (let score = 0; score <= 100; score++) {
    assert.equal(ringTone(score), fitTone(score), `score ${score}`);
  }
});
