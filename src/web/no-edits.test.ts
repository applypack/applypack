import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noEditsLine } from './no-edits';

test('an empty list says which kind of empty it is', () => {
  // Room to grow: the list is short for its own sake, so offer the retry.
  const roomy = noEditsLine({ score: 40, ceiling: 78 });
  assert.match(roomy.text, /could reach 78/);
  assert.equal(roomy.offerRewrite, true);

  // A ceiling nobody would apply on: the gap is experience, whatever the room.
  const hopeless = noEditsLine({ score: 0, ceiling: 30 });
  assert.match(hopeless.text, /reaches only 30/);
  assert.match(hopeless.text, /no wording fixes/);
  assert.equal(hopeless.offerRewrite, false);

  // Already near a ceiling worth having: nothing is wrong, and nothing to retry.
  const done = noEditsLine({ score: 88, ceiling: 90 });
  assert.match(done.text, /already saying what it can/);
  assert.equal(done.offerRewrite, false);

  // A row written before the ceiling existed keeps the plain sentence.
  assert.deepEqual(noEditsLine(null), { text: 'No edits suggested.', offerRewrite: false });
});
