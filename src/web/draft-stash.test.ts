import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStash } from './draft-stash';

test('a draft is taken once', () => {
  const stash = createDraftStash(() => 1000);
  const id = stash.put({ matchId: 55, text: 'new text' });
  assert.deepEqual(stash.take(id), { matchId: 55, text: 'new text' });
  assert.equal(stash.take(id), null, 'a reload does not get the upload back');
  assert.equal(stash.take('missing'), null);
});

test('drafts expire after the TTL', () => {
  let clock = 0;
  const stash = createDraftStash(() => clock);
  const id = stash.put({ matchId: 55, text: 'x' });
  clock = 10 * 60_000 + 1;
  assert.equal(stash.take(id), null);
});

test('each draft gets its own id', () => {
  const stash = createDraftStash(() => 0);
  const a = stash.put({ matchId: 1, text: 'a' });
  const b = stash.put({ matchId: 1, text: 'b' });
  assert.notEqual(a, b);
  assert.equal(stash.take(b)?.text, 'b');
});
