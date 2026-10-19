import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNJUDGED, type FileChange } from '../datasets/folder-scan';
import { beginFolderTick, countTurnedAway, looksToKeep, stageFolderLook, takeFolderLooks, withTurnedAway, type FolderLook, type TurnedAwayTally } from './folder-ledger';

const at = new Date('2026-10-11T12:00:00Z');
const NOW = at.getTime();
const look = (companyId: number): FolderLook => ({ companyId, at, seen: ['a.json'], changes: [], rulesKey: 'k' });
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

// #448: what the filter and the employer gate turned away of a file is how the next look knows to read it again.
test('withTurnedAway: adds the tick’s turned-away rows to the files they came from, by folder', () => {
  const change = (relPath: string, judged: Partial<FileChange> = {}): FileChange => ({
    relPath,
    size: 10,
    mtimeMs: 0,
    kind: 'json',
    sha256: 'h',
    status: 'done',
    detail: null,
    jobCount: 4,
    rowsRead: 4,
    ...UNJUDGED,
    ...judged,
  });
  const tally: TurnedAwayTally = new Map();
  countTurnedAway(tally, 1, 'a.json');
  countTurnedAway(tally, 1, 'a.json');
  countTurnedAway(tally, 1, 'a.json', new Date(NOW + 5));
  countTurnedAway(tally, 1, 'a.json', new Date(NOW + 9));
  countTurnedAway(tally, 2, 'a.json');
  const looks = [
    { ...look(1), changes: [change('a.json', { turnedAway: 1, windowTurnedAway: 1, windowEndsAt: NOW + 20 }), change('b.json')] },
    { ...look(2), changes: [change('a.json', { turnedAway: null })] },
  ];
  const [one, two] = withTurnedAway(looks, tally);
  assert.deepEqual(
    one!.changes.map((c) => [c.relPath, c.turnedAway, c.windowTurnedAway, c.windowEndsAt]),
    [
      ['a.json', 3, 3, NOW + 5],
      ['b.json', 0, 0, null],
    ],
  );
  // A file read before rows were counted stays uncounted until it is read whole.
  assert.equal(two!.changes[0]!.turnedAway, null);
  // The soonest window to close is the one that counts: the file is read again then, and the later one noted.
  assert.equal(withTurnedAway([{ ...look(1), changes: [change('a.json')] }], tally)[0]!.changes[0]!.windowEndsAt, NOW + 5);
  assert.equal(withTurnedAway([{ ...look(1), changes: [change('a.json', { windowEndsAt: NOW + 1 })] }], tally)[0]!.changes[0]!.windowEndsAt, NOW + 1);
});
