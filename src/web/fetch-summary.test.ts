import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFetchRun } from './fetch-summary';

const base = { fetched: 312, sources: 71, sourcesFailed: 0, durationMs: 40_000, persisted: 118 };

test('a run that met another fetch says it did nothing and why', () => {
  const { kind, text } = summarizeFetchRun({ skipped: 1, reason: 'overlap' });
  assert.equal(kind, 'warn');
  assert.match(text, /did nothing: another fetch is running/);
});

test('a run with no source to read says so, and does not blame the network (#557)', () => {
  const { kind, text } = summarizeFetchRun({ reason: 'no-sources', fetched: 0, sources: 0, sourcesFailed: 0, durationMs: 30 });
  assert.equal(kind, 'warn');
  assert.match(text, /^Fetch now: no source to read/);
  assert.doesNotMatch(text, /network/);
});

test('a paused-pipeline run reports unscored storage and no AI spend', () => {
  const { kind, text } = summarizeFetchRun({ ...base, classify: false });
  assert.equal(kind, 'ok');
  assert.match(text, /312 jobs from 71 sources in 40\.0s — 118 new stored unscored/);
  assert.match(text, /no AI spent/);
});

test("the setup wizard's test search leaves the scoring to its last step, and never says paused", () => {
  const { kind, text } = summarizeFetchRun({ ...base, classify: false, filterRejected: 55, rejectedWorkplace: 55 }, 'Test search', true);
  assert.equal(kind, 'ok');
  assert.match(text, /^Test search: 312 jobs from 71 sources in 40\.0s — 118 new stored\. The filter set aside 55: 55 .*\. Setup scores the best of them at its last step/);
  assert.doesNotMatch(text, /paused|Save & re-classify/);
});

test('a running-pipeline run reports scored and alerted counts', () => {
  const { kind, text } = summarizeFetchRun({ ...base, classified: 100, alerted: 5, sourcesFailed: 3 });
  assert.equal(kind, 'ok');
  assert.match(text, /71 sources \(3 failed\)/);
  assert.match(text, /118 new stored, 100 scored, 5 alerted\./);
});

test('a run the filter thinned says which gates took the most (N2)', () => {
  const stats = { ...base, persisted: 0, classified: 0, filterRejected: 300, rejectedTitle: 270, rejectedPlace: 25, rejectedExcluded: 5 };
  assert.match(summarizeFetchRun(stats).text, /0 alerted\. The filter set aside 300: 270 without a title keyword, 25 outside your places\.$/);
  assert.match(summarizeFetchRun({ ...stats, classify: false }).text, /paused\. The filter set aside 300: .* Score them later/);
  // A run from before the counters, or one the filter left alone, says nothing about it.
  assert.doesNotMatch(summarizeFetchRun({ ...base, filterRejected: 300 }).text, /filter/);
});

test('zero jobs is not a warning when the sources were simply unchanged', () => {
  // 44 of 62 sources answer 304 on an ordinary second tick; "check the
  // network" would be nonsense there.
  const { kind, text } = summarizeFetchRun({ ...base, fetched: 0, persisted: 0, sources: 62, sourcesUnchanged: 44 });
  assert.equal(kind, 'ok');
  assert.match(text, /44 of 62 sources unchanged since the last tick/);
});

test('names the unchanged sources alongside the fetched ones', () => {
  const { text } = summarizeFetchRun({ ...base, sources: 62, sourcesUnchanged: 44, sourcesFailed: 2 });
  assert.match(text, /62 sources \(44 unchanged, 2 failed\)/);
});

test('zero jobs from every source points at the network', () => {
  const { kind, text } = summarizeFetchRun({ ...base, fetched: 0, persisted: 0, sourcesFailed: 71 });
  assert.equal(kind, 'warn');
  assert.match(text, /no jobs from 71 sources \(71 failed\)/);
  assert.match(text, /Quiet sources/);
});

test('aborted runs and a blank profile are named honestly', () => {
  assert.equal(summarizeFetchRun({ aborted: 1, reason: 'no-active-profile' }).kind, 'err');
  const paused = summarizeFetchRun({ aborted: 1, reason: 'paused-mid-run', fetched: 40, sources: 9, durationMs: 9_000 });
  assert.equal(paused.kind, 'warn');
  assert.match(paused.text, /paused mid-run after 9 sources/);
  const blank = summarizeFetchRun({ ...base, persisted: 0, skippedBlankProfile: 1 });
  assert.equal(blank.kind, 'warn');
  assert.match(blank.text, /every running search is empty/);
  const midRun = summarizeFetchRun({ ...base, abortedMidRun: 1, skippedByPause: 20 });
  assert.equal(midRun.kind, 'warn');
  assert.match(midRun.text, /paused mid-run/);
});

test('summarizeFetchRun opens with the label the run was started under', () => {
  const { text } = summarizeFetchRun({ fetched: 0, sources: 1, sourcesUnchanged: 1, durationMs: 400 }, 'Checked Acme');
  assert.match(text, /^Checked Acme: nothing new in /);
});
