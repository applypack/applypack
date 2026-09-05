import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packMessages } from './pack';

test('packs blocks under a header until the limit, then starts a new message with the block', () => {
  const out = packMessages('HEAD', ['aaaa', 'bbbb', 'cccc'], '|', 12);
  assert.deepEqual(out, ['HEAD|aaaa', 'bbbb|cccc']);
  assert.deepEqual(packMessages('HEAD', [], '|', 12), ['HEAD']);
  // A block bigger than the limit still goes out, on its own.
  assert.deepEqual(packMessages('H', ['x'.repeat(30), 'y'], '|', 12), ['H', 'x'.repeat(30), 'y']);
});
