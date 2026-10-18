import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPack, forPack } from './ai-subject';

test('a call is filed under the pack being prepared, however deep it is made, and under none outside (#487)', async () => {
  assert.equal(currentPack(), undefined);
  const deep = async (): Promise<number | undefined> => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return currentPack();
  };
  const [a, b] = await Promise.all([forPack(7, deep), forPack(8, () => Promise.all([deep(), deep()]).then(([x]) => x))]);
  assert.deepEqual([a, b], [7, 8]);
  assert.equal(currentPack(), undefined);
});
