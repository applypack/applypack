import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForLock } from './lock-wait';

/** A clock that only moves when somebody sleeps, and a lock that comes free at a given time. */
function world(freeAt: number) {
  let now = 0;
  let asks = 0;
  return {
    clock: { now: () => now, sleep: async (ms: number) => void (now += ms) },
    tryLock: async () => (asks++, now >= freeAt ? { takenAt: now } : null),
    asks: () => asks,
    now: () => now,
  };
}
const MINUTE = 60_000;

test('a lock that is free is taken at the first ask, with no wait', async () => {
  const w = world(0);
  assert.deepEqual(await waitForLock(w.tryLock, { everyMs: MINUTE, waitMs: 50 * MINUTE }, w.clock), { takenAt: 0 });
  assert.equal(w.asks(), 1);
});

// #397: an import that scored for two minutes cost the hour its search, because the tick asked once.
test('a lock somebody holds is asked for again until it is free', async () => {
  const w = world(2.5 * MINUTE);
  assert.deepEqual(await waitForLock(w.tryLock, { everyMs: MINUTE, waitMs: 50 * MINUTE }, w.clock), { takenAt: 3 * MINUTE });
  assert.equal(w.asks(), 4);
});

test('the wait ends with nothing once its time is up, and no ask is started past it', async () => {
  const w = world(Number.POSITIVE_INFINITY);
  assert.equal(await waitForLock(w.tryLock, { everyMs: MINUTE, waitMs: 5 * MINUTE }, w.clock), null);
  assert.deepEqual([w.asks(), w.now()], [6, 5 * MINUTE]);
  // No time to wait is one ask.
  const once = world(Number.POSITIVE_INFINITY);
  assert.equal(await waitForLock(once.tryLock, { everyMs: MINUTE, waitMs: 0 }, once.clock), null);
  assert.equal(once.asks(), 1);
});

test('a process that is stopping stops waiting within a second, and asks for nothing more', async () => {
  const w = world(Number.POSITIVE_INFINITY);
  const got = await waitForLock(w.tryLock, { everyMs: MINUTE, waitMs: 50 * MINUTE, stopping: () => w.now() >= 90_000 }, w.clock);
  assert.equal(got, null);
  assert.deepEqual([w.asks(), w.now()], [2, 90_000]);
  // Already stopping: not even the first ask.
  const gone = world(0);
  assert.equal(await waitForLock(gone.tryLock, { everyMs: MINUTE, waitMs: MINUTE, stopping: () => true }, gone.clock), null);
  assert.equal(gone.asks(), 0);
});
