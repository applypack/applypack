import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeImport } from './import-summary';

const base = { fetched: 250, persisted: 37, duplicate: 0, durationMs: 9_000 };
const say = (stats: Parameters<typeof summarizeImport>[0]) => summarizeImport(stats, 'jobs.json', 'September export');

test('an import that met a running fetch imported nothing, and says what to do', () => {
  const { kind, text } = say({ skipped: 1, reason: 'overlap' });
  assert.equal(kind, 'warn');
  assert.match(text, /^Nothing was imported: a fetch is running/);
  assert.match(text, /press Import again\.$/);
});

test('an import with no search running is an error with the way forward', () => {
  const { kind, text } = say({ aborted: 1, reason: 'no-active-profile' });
  assert.equal(kind, 'err');
  assert.match(text, /Settings → Job search/);
});

test('every search blank: nothing stored, and why', () => {
  const { kind, text } = say({ ...base, persisted: 0, skippedBlankProfile: 1 });
  assert.equal(kind, 'warn');
  assert.match(text, /^Nothing was stored from jobs\.json: every running search is empty/);
});

test('a scored import names the file, the source and the counts', () => {
  const { kind, text } = say({ ...base, classified: 37, alerted: 4 });
  assert.equal(kind, 'ok');
  assert.equal(text, 'Imported jobs.json into "September export": 250 rows, 37 new stored, 37 scored, 4 alerted.');
});

test('a paused import stored unscored and spent no AI', () => {
  const { kind, text } = say({ ...base, classify: false });
  assert.equal(kind, 'ok');
  assert.match(text, /37 new stored unscored — no AI spent while fetching is paused\. Score them later/);
  assert.doesNotMatch(say({ ...base, persisted: 0, classify: false }).text, /Score them later/);
});

test('a newer export of the same source says what was there already, and what the filter took', () => {
  const stats = { ...base, persisted: 5, classified: 5, alerted: 0, duplicate: 112, filterRejected: 133, rejectedTitle: 120, rejectedPlace: 13 };
  assert.match(say(stats).text, /5 new stored, 5 scored, 0 alerted\. 112 rows were already stored\. The filter set aside 133: 120 without a title keyword, 13 outside your places\.$/);
  assert.match(say({ ...stats, duplicate: 1 }).text, /1 row was already stored\./);
  assert.match(say({ ...base, fetched: 1, persisted: 1, classified: 1 }).text, /: 1 row, 1 new stored/);
});

test('a pause mid-run and a failing engine both say the file can be imported again', () => {
  const paused = say({ ...base, abortedMidRun: 1 });
  assert.equal(paused.kind, 'warn');
  assert.match(paused.text, /the rest was skipped when fetching was paused mid-run\. Import the file again/);
  const failed = say({ ...base, classified: 30, alerted: 1, classifyFailed: 7 });
  assert.equal(failed.kind, 'warn');
  assert.match(failed.text, /7 rows could not be scored — the AI engine failed — and were not stored; import the file again to retry\.$/);
});
