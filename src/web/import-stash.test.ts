import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyMapping } from '../datasets/map';
import { dropImport, getImport, stashImport } from './import-stash';

const fields = (fileName: string) => ({
  fileName,
  format: 'json' as const,
  rows: [{ title: fileName }],
  over: 0,
  notRows: 0,
  source: { id: null, name: 'Test source' },
  mapping: emptyMapping(),
  guessed: [],
});

test('a stashed upload is found by its id until it is dropped', () => {
  const stash = stashImport(fields('a.json'));
  assert.match(stash.id, /^[0-9a-f-]{36}$/);
  assert.equal(getImport(stash.id)?.fileName, 'a.json');
  dropImport(stash.id);
  assert.equal(getImport(stash.id), null);
  assert.equal(getImport('no-such-id'), null);
});

test('only a handful are kept: the oldest makes room for the newest', () => {
  const ids = ['1', '2', '3', '4', '5'].map((n) => stashImport(fields(`${n}.json`)).id);
  assert.equal(getImport(ids[0]!), null);
  assert.deepEqual(ids.slice(1).map((id) => getImport(id)?.fileName), ['2.json', '3.json', '4.json', '5.json']);
  ids.forEach(dropImport);
});

test('an upload older than half an hour is forgotten', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const stash = stashImport(fields('old.json'));
  t.mock.timers.tick(29 * 60_000);
  assert.equal(getImport(stash.id)?.fileName, 'old.json');
  t.mock.timers.tick(2 * 60_000);
  assert.equal(getImport(stash.id), null);
});
