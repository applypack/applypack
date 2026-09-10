import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginOnce, endOnce, INFLIGHT_TTL_MS, once } from './inflight';

test('beginOnce holds a key until endOnce or the ceiling', () => {
  assert.equal(beginOnce('a', 1000), true);
  assert.equal(beginOnce('a', 2000), false);
  endOnce('a');
  assert.equal(beginOnce('a', 3000), true);
  assert.equal(beginOnce('a', 3000 + INFLIGHT_TTL_MS), true, 'an expired hold is not a hold');
  endOnce('a');
});

test('once runs the work for the first caller and answers busy to the second', async () => {
  let resolve!: () => void;
  const gate = new Promise<void>((r) => (resolve = r));
  const first = once('k', async () => { await gate; return 'done'; }, () => 'busy');
  const second = once('k', async () => 'second', () => 'busy');
  assert.equal(await second, 'busy');
  resolve();
  assert.equal(await first, 'done');
  assert.equal(await once('k', async () => 'again', () => 'busy'), 'again', 'released after the work');
});
