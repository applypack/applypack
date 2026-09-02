import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimRun, findLiveRun, getRun, startRun, updateRun } from './target-runs';

/*
 * Issue #76 — server-side idempotency for the POSTs that start AI runs. Every
 * test here has to fail for the OLD code, so none of them may check a single
 * happy-path start: what is at stake is what two requests do, not one.
 */

const fields = { steps: ['match'] as const, jobTitle: 'Backend engineer', resumeName: 'CV v4' };

function claim(key: string) {
  return claimRun(key, { ...fields, steps: [...fields.steps] });
}

test('two POSTs in flight for the same work produce ONE run', () => {
  const key = `match:1:2:fast:${Math.random()}`;
  const first = claim(key);
  // No await between the two: this is the second request arriving while the
  // first handler is still inside its own tick, which is the case SUBMIT_ONCE
  // cannot cover (second tab, scripting off, a re-POSTed reload).
  const second = claim(key);

  assert.equal(first.joined, false);
  assert.equal(second.joined, true);
  assert.equal(second.run.id, first.run.id);
});

test('different work still starts its own run', () => {
  const stamp = Math.random();
  const a = claim(`match:1:2:fast:${stamp}`);
  const b = claim(`match:1:2:full:${stamp}`);
  assert.equal(b.joined, false);
  assert.notEqual(b.run.id, a.run.id);
});

test('a run that finished is not joined — asking again starts a fresh one', () => {
  const key = `review:7:v3:${Math.random()}`;
  const first = claim(key);
  updateRun(first.run.id, { stage: 'done', resultUrl: '/resumes/7' });

  const second = claim(key);
  assert.equal(second.joined, false);
  assert.notEqual(second.run.id, first.run.id);
  // The finished run stays readable — its result page is still a valid URL.
  assert.equal(getRun(first.run.id)?.stage, 'done');
});

test('a failed run is not joined either — the retry is a new run', () => {
  const key = `scan:9:${Math.random()}`;
  const first = claim(key);
  updateRun(first.run.id, { stage: 'error', error: 'boom' });

  const second = claim(key);
  assert.equal(second.joined, false);
  assert.notEqual(second.run.id, first.run.id);
});

test('the work runs once: the second claim must not start a second chain', async () => {
  const key = `letter:42:1:${Math.random()}`;
  let calls = 0;
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  for (let i = 0; i < 2; i += 1) {
    const { run, joined } = claim(key);
    if (joined) continue;
    startRun(run.id, async () => {
      calls += 1;
      await gate;
      updateRun(run.id, { stage: 'done' });
    });
  }
  // Still in flight — the second claimant joined rather than paying again.
  assert.equal(calls, 1);
  assert.notEqual(findLiveRun(key), null);

  release();
  await gate;
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  assert.equal(findLiveRun(key), null);
});
