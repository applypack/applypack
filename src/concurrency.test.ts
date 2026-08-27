import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from './concurrency';

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

test('createLimiter never runs more than max tasks at once', async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  const task = async (): Promise<void> => {
    active++;
    peak = Math.max(peak, active);
    await tick();
    await tick();
    active--;
  };
  await Promise.all(Array.from({ length: 6 }, () => limit(task)));
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('createLimiter starts tasks in call order and keeps results in order', async () => {
  const limit = createLimiter(3);
  const started: number[] = [];
  const results = await Promise.all(
    [0, 1, 2, 3, 4].map((i) =>
      limit(async () => {
        started.push(i);
        // Later tasks finish first; order of results must not depend on it.
        for (let n = 4 - i; n > 0; n--) await tick();
        return i * 10;
      }),
    ),
  );
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.deepEqual(results, [0, 10, 20, 30, 40]);
});

test('createLimiter frees the slot when a task rejects', async () => {
  const limit = createLimiter(1);
  await assert.rejects(limit(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await limit(async () => 'ok'), 'ok');
});

test('createLimiter rejects a non-positive max', () => {
  assert.throws(() => createLimiter(0), RangeError);
});
