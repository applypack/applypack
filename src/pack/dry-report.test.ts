import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dryReport, percentile, readDryRecords, type DryRecord } from './dry-report';
import { DEFAULT_MIN_CEILING } from './gate';
import { DEFAULT_POLICY } from './policy';

const SETTINGS = { minFit: 90, minCeiling: DEFAULT_MIN_CEILING, policy: DEFAULT_POLICY };

const record = (over: Partial<DryRecord>): DryRecord => ({
  jobId: 1,
  title: 'Senior Laravel Engineer',
  company: 'Acme',
  fit: 92,
  stop: null,
  why: null,
  ms: {},
  ...over,
});

const match = { score: 76, ceiling: 100, reused: false, actions: 5, asks: 2, unbacked: 1 };
const tailor = { applied: 6, unplaced: 1, held: 3, before: 76, after: 85, checks: [], document: 'clean' };
const verify = { verdict: 'legit', recommendation: 'apply', reused: false };

const RECORDS: DryRecord[] = [
  record({ jobId: 1, match, verify, tailor, ms: { liveness: 900, brief: 12_000, match: 29_000, verify: 180_000, tailor: 40, document: 300 } }),
  record({ jobId: 2, match: { ...match, reused: true }, verify, tailor: { ...tailor, before: 60, after: 64, rejudged: 71, checks: ['shorter'] }, ms: { verify: 120_000 } }),
  record({ jobId: 3, stop: 'closed', why: 'The board no longer lists it', ms: { liveness: 700 } }),
  record({ jobId: 4, stop: 'low-ceiling', why: 'Editing can take this resume to 49 at most', match: { ...match, score: 7, ceiling: 49 }, ms: { brief: 14_000, match: 31_000 } }),
  record({ jobId: 5, stop: 'failed-gate', why: 'Based in the EU | not\nTexas', match, ms: { match: 33_000 } }),
  record({ jobId: 6, stop: 'fake', why: 'Asks for payment', match, verify: { ...verify, verdict: 'fake', recommendation: 'skip' }, ms: { verify: 240_000 } }),
  record({ jobId: 7, stop: 'error', why: 'Comparison failed: timed out', ms: { brief: 11_000 } }),
];

test('percentile is the nearest rank, never an average of two runs', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([30, 10, 20], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 90), 40);
  assert.equal(percentile([7], 90), 7);
});

test('the funnel counts who reached each step and what stopped them there', () => {
  const report = dryReport(RECORDS, SETTINGS);
  assert.match(report, /7 postings with fit ≥ 90 · ceiling floor 75 · edits in title, summary, skills, experience · 2 bullets at most · nothing removed/);
  assert.match(report, /\*\*Ready: 2 of 7\.\*\*/);
  assert.match(report, /\| Still open\? \| 7 \| 1 closed \|/);
  assert.match(report, /\| Compared with the resume \| 5 \| 1 failed a requirement, 1 under the ceiling floor \|/);
  assert.match(report, /\| Company checked \| 3 \| 1 fake \|/);
  assert.match(report, /\| Resume tailored \| 2 \| — \|/);
  assert.match(report, /A step failed on 1:/);
});

test('a step is timed over the runs that did the work, and a whole pack only when nothing was reused', () => {
  const report = dryReport(RECORDS, SETTINGS);
  assert.match(report, /\| Compare \| 3 \| 31 s \| 33 s \|/);
  assert.match(report, /\| Check the company \(web\) \| 3 \| 180 s \| 240 s \|/);
  assert.doesNotMatch(report, /Judge the tailored text again \|/);
  assert.match(report, /A whole pack with nothing reused: median 222 s, 90th percentile 222 s \(1 runs\)\./);
});

test('a ready pack shows the score before and after, the company verdict and what was left', () => {
  const report = dryReport(RECORDS, SETTINGS);
  assert.match(report, /Median lift from the edits: \+4 points/);
  assert.match(report, /\| 1 · Senior Laravel Engineer · Acme \| 92 \| 76 → 85 · ceiling 100 \| legit · apply \| 6 applied, 1 unplaced \| 3 held, 2 to ask, 1 unbacked \| ok \| clean \|/);
  assert.match(report, /\| 60 → 64 \(judged again: 71\) · ceiling 100 \|.*\| shorter \| clean \|/);
});

test('a stop keeps its reason on one line of the table', () => {
  const report = dryReport(RECORDS, SETTINGS);
  assert.match(report, /\| 5 · Senior Laravel Engineer · Acme \| 92 \| 76 · ceiling 100 \| failed a requirement \| Based in the EU \/ not Texas \|/);
  assert.match(report, /\| 7 · Senior Laravel Engineer · Acme \| 92 \| — \| a step failed \| Comparison failed: timed out \|/);
});

test('nothing ready and nothing stopped leave their sections out', () => {
  const report = dryReport([RECORDS[0]!], SETTINGS);
  assert.doesNotMatch(report, /## Stopped/);
  assert.doesNotMatch(dryReport([RECORDS[2]!], SETTINGS), /## Ready/);
});

test('records read back as written; anything else is dropped so its posting runs again', () => {
  assert.deepEqual(readDryRecords(JSON.parse(JSON.stringify(RECORDS))), RECORDS);
  assert.deepEqual(readDryRecords([RECORDS[2], { jobId: 'x' }, null, { ...RECORDS[3], stop: 'paused' }]), [RECORDS[2]]);
  assert.deepEqual(readDryRecords({ not: 'a list' }), []);
});
