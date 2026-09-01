import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLatchingProbe } from './cancellation';

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test('reads on first call and returns the value', async () => {
  const clock = fakeClock();
  let reads = 0;
  const probe = makeLatchingProbe(
    async () => {
      reads++;
      return false;
    },
    5000,
    clock.now,
  );
  assert.equal(await probe(), false);
  assert.equal(reads, 1);
});

test('throttles reads inside the interval', async () => {
  const clock = fakeClock();
  let reads = 0;
  const probe = makeLatchingProbe(
    async () => {
      reads++;
      return false;
    },
    5000,
    clock.now,
  );
  await probe();
  clock.advance(4999);
  assert.equal(await probe(), false);
  assert.equal(reads, 1);
  clock.advance(1);
  assert.equal(await probe(), false);
  assert.equal(reads, 2);
});

test('latches true and stops reading', async () => {
  const clock = fakeClock();
  const answers = [false, true, false];
  let reads = 0;
  const probe = makeLatchingProbe(
    async () => {
      const v = answers[reads] ?? false;
      reads++;
      return v;
    },
    5000,
    clock.now,
  );
  assert.equal(await probe(), false);
  clock.advance(5000);
  assert.equal(await probe(), true);
  // Latched: no further reads even after the interval, and a later false
  // from the source could not un-latch it anyway.
  clock.advance(60_000);
  assert.equal(await probe(), true);
  assert.equal(reads, 2);
});

test('throttled calls between reads return the last value, not a read', async () => {
  const clock = fakeClock();
  let reads = 0;
  const probe = makeLatchingProbe(
    async () => {
      reads++;
      return reads >= 2;
    },
    1000,
    clock.now,
  );
  assert.equal(await probe(), false);
  assert.equal(await probe(), false); // same tick — throttled
  assert.equal(reads, 1);
  clock.advance(1000);
  assert.equal(await probe(), true);
  assert.equal(reads, 2);
});
