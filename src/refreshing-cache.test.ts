import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshingCache } from './refreshing-cache';

const TTL = 60_000;

/** A clock the test moves, and a read it counts and can hold open. */
function harness() {
  let clock = 0;
  let reads = 0;
  let release: (() => void) | null = null;
  const cache = refreshingCache<string, number>(TTL, () => clock);
  const read = (held = false) => (): Promise<number> => {
    reads += 1;
    const value = reads;
    if (!held) return Promise.resolve(value);
    return new Promise((resolve) => {
      release = () => resolve(value);
    });
  };
  return {
    cache,
    read,
    reads: () => reads,
    tick: (ms: number) => {
      clock += ms;
    },
    release: () => release?.(),
  };
}

test('a kept reading answers inside its minute, and nothing is read again', async () => {
  const h = harness();
  assert.equal(await h.cache.get('en', h.read()), 1);
  h.tick(TTL - 1);
  assert.equal(await h.cache.get('en', h.read()), 1);
  assert.equal(h.reads(), 1);
});

test('past its minute the old reading answers at once and a new one is taken behind it (#649)', async () => {
  const h = harness();
  await h.cache.get('en', h.read());
  h.tick(TTL);
  const answer = await h.cache.get('en', h.read(true));
  assert.equal(answer, 1, 'the page does not wait');
  assert.equal(h.reads(), 2);
  assert.equal(await h.cache.get('en', h.read()), 1, 'one reading at a time: a caller meanwhile gets the old one');
  assert.equal(h.reads(), 2);
  h.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await h.cache.get('en', h.read()), 2, 'the new reading answers from then on');
});

test('a caller that asks for a fresh reading waits for it, and shares one already under way', async () => {
  const h = harness();
  await h.cache.get('en', h.read());
  h.tick(TTL);
  const behind = h.cache.get('en', h.read(true));
  const fresh = h.cache.get('en', h.read(), { fresh: true });
  h.release();
  assert.equal(await behind, 1);
  assert.equal(await fresh, 2);
  assert.equal(h.reads(), 2);
});

test('nothing kept: everyone waits for the one reading, and each key keeps its own', async () => {
  const h = harness();
  const first = h.cache.get('en', h.read(true));
  const second = h.cache.get('en', h.read());
  h.release();
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(await h.cache.get('uk', h.read()), 2);
  assert.equal(await h.cache.get('en', h.read()), 1);
});

test('forget drops the reading, and one begun before it is not kept', async () => {
  const h = harness();
  await h.cache.get('en', h.read());
  h.tick(TTL);
  await h.cache.get('en', h.read(true));
  h.cache.forget();
  h.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await h.cache.get('en', h.read()), 3, 'a key saved meanwhile is read again, not the reading from before');
});

test('a reading behind the page that fails keeps the last one, and a waiting caller sees the failure', async () => {
  let clock = 0;
  const cache = refreshingCache<string, number>(TTL, () => clock);
  await cache.get('en', async () => 1);
  clock = TTL;
  assert.equal(await cache.get('en', () => Promise.reject(new Error('spawn failed'))), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await cache.get('en', async () => 2, { fresh: false }), 1, 'still the last good one, read again behind it');
  await assert.rejects(refreshingCache<string, number>(TTL).get('en', () => Promise.reject(new Error('spawn failed'))), /spawn failed/);
});
