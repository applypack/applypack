import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFetchRun } from './fetch-summary';

const base = { fetched: 312, sources: 71, sourcesFailed: 0, durationMs: 40_000, persisted: 118 };

test('a paused-pipeline run reports unscored storage and no AI spend', () => {
  const { kind, text } = summarizeFetchRun({ ...base, classify: false });
  assert.equal(kind, 'ok');
  assert.match(text, /312 jobs from 71 sources in 40\.0s — 118 new stored unscored/);
  assert.match(text, /no AI spent/);
});

test('a running-pipeline run reports scored and alerted counts', () => {
  const { kind, text } = summarizeFetchRun({ ...base, classified: 100, alerted: 5, sourcesFailed: 3 });
  assert.equal(kind, 'ok');
  assert.match(text, /71 sources \(3 failed\)/);
  assert.match(text, /118 new stored, 100 scored, 5 alerted\./);
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
