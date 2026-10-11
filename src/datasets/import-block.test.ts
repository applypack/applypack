import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importBlock } from './preview';
import { importBlockText } from '../web/import-summary';

const offered = { mappingUsable: true, jobs: 12, searches: { running: 1, usable: 1 }, scoring: true, passing: 4 };

test('an import is offered when something new would be stored', () => {
  assert.equal(importBlock(offered), null);
  // Paused: rows are stored unscored, and a blank search admits them.
  assert.equal(importBlock({ ...offered, scoring: false, searches: { running: 1, usable: 0 } }), null);
});

test('an import is refused for one reason, the first that holds', () => {
  assert.equal(importBlock({ ...offered, mappingUsable: false, jobs: 0, passing: 0 }), 'mapping');
  assert.equal(importBlock({ ...offered, jobs: 0, passing: 0 }), 'no-job');
  assert.equal(importBlock({ ...offered, searches: { running: 0, usable: 0 } }), 'no-search');
  assert.equal(importBlock({ ...offered, searches: { running: 2, usable: 0 } }), 'blank-searches');
});

test('rows none of which is new and wanted are not imported: the source would be left empty (#364)', () => {
  // The live case: 2,000 rows whose titles carry no keyword of a running search; the page disabled Import, the server ran it.
  assert.equal(importBlock({ ...offered, jobs: 2_000, passing: 0 }), 'nothing');
  assert.equal(importBlockText('nothing'), 'Nothing here is both new and wanted by a running search, so there is nothing to import.');
});

test('every reason has its sentence', () => {
  for (const block of ['mapping', 'no-job', 'no-search', 'blank-searches', 'nothing'] as const) assert.ok(importBlockText(block).length > 20, block);
});
