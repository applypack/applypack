import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asRewrites, loadLineDiff } from './line-diff';

test('a line rewritten past the overlap threshold counts once, as Was / Now (#642)', async () => {
  const { diffLines } = await loadLineDiff();
  const before = 'Dana Ruiz\nSoftware Engineer, Backend\nBuilt the API.\nKept line.\nDropped line.';
  const after = 'Dana Ruiz\nStaff Platform Developer (Payments)\nBuilt the API in Node.js.\nKept line.';
  const raw = diffLines(before, after).filter((op) => op.op !== 'keep');
  // The diff itself leaves the block apart once the title's words did not survive: five rows for three edits.
  assert.deepEqual(raw.map((op) => op.op), ['delete', 'delete', 'insert', 'insert', 'delete']);
  const rows = asRewrites(diffLines(before, after)).filter((op) => op.op !== 'keep');
  assert.deepEqual(rows.map((op) => op.op), ['change', 'change', 'delete']);
  const title = rows[0]!;
  assert.ok(title.op === 'change' && title.a.text === 'Software Engineer, Backend' && title.b.text === 'Staff Platform Developer (Payments)');
});

test('a delete and an insert with a kept line between them stay two edits', async () => {
  const { diffLines } = await loadLineDiff();
  const rows = asRewrites(diffLines('One.\nTwo.\nThree.', 'Two.\nThree.\nFour, unrelated.')).filter((op) => op.op !== 'keep');
  assert.deepEqual(rows.map((op) => op.op), ['delete', 'insert']);
});
