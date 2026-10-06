import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainFolderFault, fileLine, folderCheckLine, folderLine } from './folder-words';

const at = new Date('2026-10-05T12:00:00Z');

test('folderLine: what a folder holds and what the last check found', () => {
  assert.equal(folderLine(undefined), 'Not checked yet.');
  assert.equal(folderLine({ lastLookAt: at, files: 214, fresh: 3, waiting: 0, failed: 0 }), '214 files · 3 new at the last check');
  assert.equal(folderLine({ lastLookAt: at, files: 1, fresh: 0, waiting: 1, failed: 2 }), '1 file · 0 new at the last check · 1 waiting · 2 not read');
});

test('fileLine: each state of a file as a badge and a sentence', () => {
  assert.deepEqual(fileLine({ status: 'done', detail: null, jobCount: 37 }, true), { label: 'Read', tone: 'ok', text: '37 rows read as jobs.' });
  assert.equal(fileLine({ status: 'done', detail: 'The first 2,000 of 2,005 rows.', jobCount: 1 }, true).text, '1 row read as a job. The first 2,000 of 2,005 rows.');
  assert.deepEqual(fileLine({ status: 'waiting', detail: 'Changed a moment ago.', jobCount: 0 }, true), { label: 'Waiting', tone: 'neutral', text: 'Changed a moment ago.' });
  assert.equal(fileLine({ status: 'failed', detail: null, jobCount: 0 }, true).label, 'Not read');
  assert.equal(fileLine({ status: 'skipped', detail: 'No rows in it.', jobCount: 0 }, true).label, 'Set aside');
});

test('fileLine: a file the last check did not find keeps its line, and its jobs', () => {
  assert.equal(fileLine({ status: 'done', detail: null, jobCount: 2 }, false).text, '2 rows read as jobs. The last check did not find it among the folder’s files; its jobs stay.');
  assert.equal(fileLine({ status: 'skipped', detail: 'No rows in it.', jobCount: 0 }, false).text, 'No rows in it. The last check did not find it among the folder’s files.');
});

test('explainFolderFault: a refused read says what the system wants, where it runs', () => {
  const refused = 'The system did not let ApplyPack read /Users/sam/Documents/jobs (EPERM).';
  assert.match(explainFolderFault('refused', refused, 'darwin', false), /EPERM\)\. macOS guards Desktop, Documents and Downloads: .*Files and Folders, or use a folder directly in your home folder/);
  assert.match(explainFolderFault('refused', refused, 'linux', false), /Check that the user ApplyPack runs as may read the folder\.$/);
  assert.match(explainFolderFault('refused', refused, 'linux', true), /in Docker, mount the folder into both services read-only/);
});

test('explainFolderFault: a missing folder in Docker points at the mount; the rest say what they said', () => {
  assert.match(explainFolderFault('missing', 'There is no folder at /inbox.', 'linux', true), /the right-hand side of the mount\.$/);
  assert.equal(explainFolderFault('missing', 'There is no folder at /x.', 'darwin', false), 'There is no folder at /x.');
  assert.equal(explainFolderFault('too-many', 'Too many entries.', 'darwin', false), 'Too many entries.');
});

test('folderCheckLine: a check that brought nothing says so without sending anyone to the network', () => {
  const source = (status: string) => ({ bySource: [{ name: 'Tool output', status, count: 0, ms: 3 }], fetched: 0, sources: 1 });
  assert.deepEqual(folderCheckLine('Checked Tool output', source('empty')), {
    kind: 'ok',
    text: 'Checked Tool output: nothing new in the folder. A file is read once, and again when it changes.',
  });
  const gone = folderCheckLine('Checked Tool output', source('slug_gone'));
  assert.equal(gone?.kind, 'err');
  assert.match(gone?.text ?? '', /the folder was not read — folder not found\. Nothing stored is touched/);
  assert.match(folderCheckLine('Checked Tool output', source('bad_payload'))?.text ?? '', /files do not fit the mapping/);
});

test('folderCheckLine: rows that came, an overlap and a run with no source are the shared summary’s to say', () => {
  assert.equal(folderCheckLine('Checked Tool output', { bySource: [{ name: 'Tool output', status: 'ok', count: 3, ms: 3 }], fetched: 3 }), null);
  assert.equal(folderCheckLine('Checked Tool output', { skipped: 1, reason: 'overlap' }), null);
  assert.equal(folderCheckLine('Checked Tool output', {}), null);
});
