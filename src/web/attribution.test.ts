import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLine } from './pages/attribution';

test('a posting from the person\'s own folder says which folder and which file', () => {
  assert.equal(
    sourceLine('alert-run.json', 'Tool output', { atsType: 'FOLDER', atsToken: '/home/a/inbox' }),
    'From your folder: Tool output / alert-run.json',
  );
});

test('a posting with no file says what its vendor asks for, or nothing', () => {
  assert.match(sourceLine(null, 'Adzuna GB', { atsType: 'ADZUNA', atsToken: 'gb' }) ?? '', /^Jobs by Adzuna/);
  assert.match(sourceLine(undefined, 'France Travail', { atsType: 'FRANCETRAVAIL', atsToken: 'codeROME=M1805' }) ?? '', /^Source: France Travail/);
  assert.equal(sourceLine(null, 'Acme', { atsType: 'GREENHOUSE', atsToken: 'acme' }), null);
  // A pasted job reaches the alert with no source at all.
  assert.equal(sourceLine(undefined, 'Acme', undefined), null);
});
