import { test } from 'node:test';
import assert from 'node:assert/strict';
import { misfitLine, misfitSince, windowMisfits } from './window-misfits';
import type { WindowAttempt } from '../ai-ledger';

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 18, 12, 0, seconds));
const attempt = (over: Partial<WindowAttempt>): WindowAttempt => ({
  engine: 'local_api',
  feature: 'resume-match',
  at: at(0),
  durationMs: 2,
  outcome: 'too_large',
  ...over,
});
const answer = (seconds: number, over: Partial<WindowAttempt> = {}) =>
  attempt({ engine: 'claude_code', at: at(seconds), durationMs: 30_000, outcome: 'ok', ...over });

test('refusals are counted per task, and one answered right after by another engine counts as answered', () => {
  const refusals = [attempt({ at: at(0) }), attempt({ at: at(40), feature: 'resume-suggestions' }), attempt({ at: at(50), feature: 'cover-letter' })];
  const fallbacks = [answer(0), answer(41, { feature: 'resume-suggestions' })];
  assert.deepEqual(windowMisfits('local_api', refusals, fallbacks), [
    { task: 'analysis', refused: 2, answered: 2 },
    { task: 'letters', refused: 1, answered: 0 },
  ]);
});

test('an answer is not borrowed: from another feature, long after, a failure, or one already counted', () => {
  const refusals = [attempt({ at: at(0) }), attempt({ at: at(0) })];
  // Two refused at once and one answer: one answered, one failed.
  assert.deepEqual(windowMisfits('local_api', refusals, [answer(0)]), [{ task: 'analysis', refused: 2, answered: 1 }]);
  assert.deepEqual(windowMisfits('local_api', [attempt({})], [answer(0, { feature: 'cover-letter' })]), [{ task: 'analysis', refused: 1, answered: 0 }]);
  assert.deepEqual(windowMisfits('local_api', [attempt({})], [answer(30)]), [{ task: 'analysis', refused: 1, answered: 0 }]);
  assert.deepEqual(windowMisfits('local_api', [attempt({})], [answer(0, { outcome: 'timeout' })]), [{ task: 'analysis', refused: 1, answered: 0 }]);
});

test("another engine's refusals and a feature of no task are left out", () => {
  assert.deepEqual(windowMisfits('local_api', [attempt({ engine: 'openai_api' }), attempt({ feature: 'engine-test' })], []), []);
});

test('the sentence names the task, the window, the count and what became of the calls', () => {
  assert.equal(
    misfitLine({ task: 'analysis', refused: 4, answered: 4 }, 16_384),
    "Resume analysis did not fit this engine's 16k window 4 times in the last 30 days; the engine behind it answered.",
  );
  assert.equal(
    misfitLine({ task: 'letters', refused: 1, answered: 0 }, 32_768),
    "Cover letters did not fit this engine's 32k window once in the last 30 days, and the call failed.",
  );
  assert.equal(
    misfitLine({ task: 'analysis', refused: 3, answered: 1 }, null),
    "Resume analysis did not fit this engine's context window 3 times in the last 30 days; the engine behind it answered 1 of them, and the rest failed.",
  );
});

test('the card looks back thirty days', () => {
  assert.equal(misfitSince(new Date('2026-10-31T00:00:00Z')).toISOString(), '2026-10-01T00:00:00.000Z');
});
