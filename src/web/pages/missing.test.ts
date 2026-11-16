import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingKind } from './missing';

test('a missing page says which of three things happened (#768)', () => {
  assert.equal(missingKind(404, '/jobs/999999'), 'job', 'a job deleted by the cleanup, reached by an old link');
  assert.equal(missingKind(404, '/jobs/12/target'), 'job');
  assert.equal(missingKind(404, '/nope/abc'), 'page');
  assert.equal(missingKind(404, '/jobs/import/abc'), 'page', 'only a numbered job is a job');
  assert.equal(missingKind(400, '/jobs/abc'), 'address');
  assert.equal(missingKind(400, '/jobs'), 'address', 'a query value no page reads');
});
