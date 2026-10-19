import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLocale, type Locale } from '../i18n/locale';
import { t } from '../i18n/t';
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

test('the matches of an import: listed in its one message, counted in it, or stored quietly (#402)', () => {
  // 300 matched: the message listed the best 20 and counted the rest.
  assert.equal(
    say({ ...base, classified: 300, matched: 300, alerted: 20, alertCounted: 280 }).text,
    'Imported jobs.json into "September export": 250 rows, 37 new stored, 300 scored, 20 alerted. The message lists the best 20; 280 more matches are counted in it and on Jobs as New.',
  );
  // "No alerts" was chosen: nothing is sent, and the flash says the matches are there.
  const quiet = say({ ...base, classified: 37, matched: 5, alerted: 0, alertSourceOff: 5 });
  assert.equal(quiet.kind, 'ok');
  assert.equal(quiet.text, 'Imported jobs.json into "September export": 250 rows, 37 new stored, 37 scored, 0 alerted. 5 matches were stored with no alert, as chosen.');
  assert.match(say({ ...base, classified: 1, alerted: 0, alertSourceOff: 1 }).text, /1 match was stored with no alert, as chosen\.$/);
  // A handful, all listed: the sentence it always was.
  assert.equal(say({ ...base, classified: 37, alerted: 4 }).text, 'Imported jobs.json into "September export": 250 rows, 37 new stored, 37 scored, 4 alerted.');
});

test('a paused import stored unscored and spent no AI', () => {
  const { kind, text } = say({ ...base, classify: false });
  assert.equal(kind, 'ok');
  assert.match(text, /37 new stored unscored — no AI spent while fetching is paused\. To score them, press “Score them” on the Overview or on Jobs\.$/);
  assert.doesNotMatch(say({ ...base, persisted: 0, classify: false }).text, /Score them/);
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

// #367: "2,000 rows, 1480 new stored … The filter set aside 2000: 2,000 without a title keyword." (#539: and no number twice)
const LANGUAGES: Locale[] = ['en', 'uk', 'es', 'fr'];
/** Spanish groups from 10,000, so the counts here are past it: no sentence may then hold five digits in a row. */
const UNGROUPED = /\d{5}/;

test('every count of a large import is written in the language\'s grouping, not only the rows', () => {
  const large = { fetched: 20_000, persisted: 14_800, duplicate: 3_200, filterRejected: 12_000, rejectedTitle: 12_000 };
  assert.equal(
    say({ fetched: 2_000, persisted: 1_480, classified: 1_480, alerted: 1_012, filterRejected: 2_000, rejectedTitle: 2_000 }).text,
    'Imported jobs.json into "September export": 2,000 rows, 1,480 new stored, 1,480 scored, 1,012 alerted. The filter set aside 2,000: all without a title keyword.',
  );
  for (const language of LANGUAGES) {
    for (const stats of [{ ...large, classified: 14_800, alerted: 10_120 }, { ...large, classify: false }, { ...large, abortedMidRun: 1 }]) {
      const text = withLocale(language, () => say(stats).text);
      assert.doesNotMatch(text, UNGROUPED, `${language}: ${text}`);
    }
  }
});

test('what the preview left out is counted the same way', () => {
  for (const language of LANGUAGES) {
    for (const key of ['import.dropped.closed', 'import.dropped.noTitle', 'import.dropped.noIdentity', 'import.dropped.repeated'] as const) {
      const text = withLocale(language, () => t(key, { n: 12_000 }));
      assert.doesNotMatch(text, UNGROUPED, `${language}: ${text}`);
    }
  }
  assert.equal(t('import.dropped.noTitle', { n: 1_034 }), '1,034 without a title');
});
