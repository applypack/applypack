import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { logFilePath, tailLines } from './log-file';

test('the log lives in the data folder, beside the database log', () => {
  assert.equal(logFilePath('/data/ap'), path.join('/data/ap', 'logs', 'applypack.log'));
});

test('the page shows the last whole lines, without the requests that simply answered (#769)', () => {
  const text = [
    'f of a line cut by the read',
    '[2026-11-15 20:35:22] INFO: fetch: done {"fetched":601}',
    '[2026-11-15 20:35:23] INFO: web: request {"method":"GET","path":"/","status":200,"durationMs":4}',
    '[2026-11-15 20:35:24] INFO: web: request {"method":"GET","path":"/jobs/9","status":404,"durationMs":1}',
    '[2026-11-15 20:35:25] ERROR: web: unhandled error {"path":"/x"}',
    '',
  ].join('\n');
  assert.deepEqual(tailLines(text), [
    '[2026-11-15 20:35:22] INFO: fetch: done {"fetched":601}',
    '[2026-11-15 20:35:24] INFO: web: request {"method":"GET","path":"/jobs/9","status":404,"durationMs":1}',
    '[2026-11-15 20:35:25] ERROR: web: unhandled error {"path":"/x"}',
  ]);
  assert.deepEqual(tailLines(text, 1), ['[2026-11-15 20:35:25] ERROR: web: unhandled error {"path":"/x"}']);
  assert.deepEqual(tailLines(''), []);
});
