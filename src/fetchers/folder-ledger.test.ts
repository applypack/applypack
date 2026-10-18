import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginFolderTick, looksToKeep, stageFolderLook, takeFolderLooks, type FolderLook } from './folder-ledger';

const at = new Date('2026-10-11T12:00:00Z');
const look = (companyId: number): FolderLook => ({ companyId, at, seen: ['a.json'], changes: [] });
const ran = { abortedMidRun: 0, skippedBlankProfile: 0 };
const ids = (looks: readonly FolderLook[]): number[] => looks.map((l) => l.companyId);

test('looksToKeep: a tick that stored everything keeps every look', () => {
  assert.deepEqual(ids(looksToKeep([look(1), look(2)], ran, new Set())), [1, 2]);
});

// #396: one posting no model scores, on any source, used to drop every folder's look, every tick.
test('looksToKeep: a posting that got no verdict costs only the folder it came from its look', () => {
  assert.deepEqual(ids(looksToKeep([look(1), look(2), look(3)], ran, new Set([2]))), [1, 3]);
  // The posting came from a board, not a folder: no look is dropped for it.
  assert.deepEqual(ids(looksToKeep([look(1), look(2)], ran, new Set([40]))), [1, 2]);
});

test('looksToKeep: a tick that stopped before its end keeps none — what it left is not known source by source', () => {
  assert.deepEqual(looksToKeep([look(1), look(2)], { abortedMidRun: 1, skippedBlankProfile: 0 }, new Set()), []);
  assert.deepEqual(looksToKeep([look(1), look(2)], { abortedMidRun: 0, skippedBlankProfile: 1 }, new Set()), []);
});

test('a look is staged per folder, handed over once, and dropped by the next tick', () => {
  beginFolderTick();
  stageFolderLook(look(1));
  stageFolderLook({ ...look(1), seen: ['b.json'] });
  stageFolderLook(look(2));
  const taken = takeFolderLooks();
  assert.deepEqual([ids(taken), taken[0]!.seen], [[1, 2], ['b.json']]);
  assert.deepEqual(takeFolderLooks(), []);
  stageFolderLook(look(3));
  beginFolderTick();
  assert.deepEqual(takeFolderLooks(), []);
});
