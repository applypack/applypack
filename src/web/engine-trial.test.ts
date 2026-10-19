import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickTrialSample,
  recordAuthors,
  recordedVerdicts,
  trialGivesUp,
  trialLine,
  trialPairs,
  trialReport,
  TRIAL_SIZE,
  type RecordedVerdict,
  type TrialReading,
} from './engine-trial';

const row = (id: number, fitScore: number) => ({ id, fitScore });

test('the sample takes one from each fit band in turn, best band first, newest first inside one', () => {
  // Newest first: ids 1… are the newest.
  const rows = [row(1, 12), row(2, 95), row(3, 30), row(4, 75), row(5, 55), row(6, 8), row(7, 91), row(8, 41)];
  assert.deepEqual(pickTrialSample(rows, 6).map((r) => r.id), [2, 4, 5, 1, 7, 8]);
  // A band that runs dry leaves its turns to the others.
  assert.deepEqual(pickTrialSample(rows, 8).map((r) => r.id), [2, 4, 5, 1, 7, 8, 3, 6]);
});

test('the sample stops at its size, and a short list is taken whole', () => {
  const low = Array.from({ length: 40 }, (_, i) => row(i + 1, 10));
  assert.equal(pickTrialSample(low).length, TRIAL_SIZE);
  assert.deepEqual(pickTrialSample(low).map((r) => r.id), low.slice(0, TRIAL_SIZE).map((r) => r.id));
  assert.deepEqual(pickTrialSample([row(1, 70), row(2, 69)]).map((r) => r.id), [1, 2]);
});

const profile = { id: 1, minFitScore: 70, minSalaryUsd: 0, updatedAt: new Date('2026-10-18T10:00:00Z') };
const job = { salaryMin: null, salaryCurrency: null, salaryPeriod: null };
const score = (fitScore: number, over: Partial<{ locationMatch: boolean; scoredAt: Date; profileId: number }> = {}) => ({
  profileId: 1,
  fitScore,
  locationMatch: true,
  scoredAt: new Date('2026-10-18T11:00:00Z'),
  ...over,
});

test('the record is judged by the search threshold as it stands now', () => {
  assert.deepEqual(recordedVerdicts(job, [score(82)], [profile]), [{ profileId: 1, fit: 82, kept: true, stale: false, sameModel: false }]);
  assert.equal(recordedVerdicts(job, [score(69)], [profile])[0]?.kept, false);
  assert.equal(recordedVerdicts(job, [score(90, { locationMatch: false })], [profile])[0]?.kept, false);
  // Under the search's salary floor: turned away, as the tick would.
  const paid = { salaryMin: 40_000, salaryCurrency: 'USD', salaryPeriod: 'year' };
  assert.equal(recordedVerdicts(paid, [score(90)], [{ ...profile, minSalaryUsd: 100_000 }])[0]?.kept, false);
});

test('a score written before the search last changed is stale; one for a search not running is left out', () => {
  assert.equal(recordedVerdicts(job, [score(50, { scoredAt: new Date('2026-10-17T00:00:00Z') })], [profile])[0]?.stale, true);
  assert.deepEqual(recordedVerdicts(job, [score(50, { profileId: 9 })], [profile]), []);
});

const verdict = (profileId: number, fit: number, kept: boolean) => ({
  profileId,
  classification: { fit_score: fit, location_match: true, salary_min: null, salary_max: null, tech_match: [], red_flags: [], summary: '' },
  dismissReason: kept ? null : ('low-fit' as const),
});
const record = (profileId: number, fit: number, kept: boolean, stale = false, sameModel = false): RecordedVerdict => ({ profileId, fit, kept, stale, sameModel });

test('a record is the latest scoring call\'s for its posting (#572)', () => {
  const authors = recordAuthors([
    { jobId: 7, engine: 'local_api', model: 'qwen3:8b' },
    { jobId: null, engine: 'claude_code', model: '' },
    { jobId: 7, engine: 'claude_code', model: 'claude-haiku-4-5' },
    { jobId: 8, engine: 'claude_code', model: '' },
  ]);
  assert.deepEqual([...authors], [
    [7, { engine: 'local_api', model: 'qwen3:8b' }],
    [8, { engine: 'claude_code', model: '' }],
  ]);
  assert.equal(recordedVerdicts(job, [score(82)], [profile], true)[0]?.sameModel, true);
});

test('pairs are the searches both sides judged', () => {
  const pairs = trialPairs([verdict(1, 80, true), verdict(2, 20, false)], [record(1, 40, false), record(3, 90, true)]);
  assert.deepEqual(pairs, [{ fit: 80, kept: true, record: record(1, 40, false) }]);
});

test('the report counts agreement, false matches, misses, distance and the middle call time', () => {
  const readings: TrialReading[] = [
    { kind: 'read', ms: 4_000, pairs: [{ fit: 80, kept: true, record: record(1, 40, false) }] },
    { kind: 'read', ms: 2_000, pairs: [{ fit: 30, kept: false, record: record(1, 75, true, true) }] },
    { kind: 'read', ms: 3_000, pairs: [{ fit: 20, kept: false, record: record(1, 25, false, false, true) }] },
    { kind: 'unparsed', ms: 9_000 },
    { kind: 'failed' },
  ];
  assert.deepEqual(trialReport(readings), {
    postings: 5,
    compared: 3,
    agreed: 1,
    falseMatches: 1,
    missed: 1,
    meanDistance: 30,
    msPerPosting: 3_500,
    unparsed: 1,
    failed: 1,
    stale: 1,
    sameModel: 1,
  });
});

test('nothing compared, nothing timed: the report says so instead of inventing a zero', () => {
  const report = trialReport([{ kind: 'failed' }]);
  assert.equal(report.meanDistance, null);
  assert.equal(report.msPerPosting, null);
  assert.equal(trialLine(report), 'No reply could be compared with the scores on record. 1 posting got no answer.');
});

test('the line reads the numbers, and the stale scores are named as a cause', () => {
  const line = trialLine({ postings: 20, compared: 20, agreed: 12, falseMatches: 8, missed: 0, meanDistance: 35.25, msPerPosting: 10_340, unparsed: 0, failed: 0, stale: 3, sameModel: 0 });
  assert.equal(
    line,
    'Agreed with the scores on record on 12 of 20: 8 false matches, 0 missed, 35.3 points apart on average. 10.3 s a posting. 3 scores on record are older than the last change to the search: a changed search changes the score.',
  );
});

test('the line says when the scores on record came from the model on trial (#572)', () => {
  const report = { postings: 5, compared: 5, agreed: 5, falseMatches: 0, missed: 0, meanDistance: 7.4, msPerPosting: null, unparsed: 0, failed: 0, stale: 0 };
  assert.equal(
    trialLine({ ...report, sameModel: 5 }),
    'Agreed with the scores on record on 5 of 5: 0 false matches, 0 missed, 7.4 points apart on average. Every score on record came from this same model, so this shows how steady its scores are, not how they compare with another model\'s.',
  );
  assert.match(trialLine({ ...report, sameModel: 2 }), /\. 2 scores on record came from this same model: there it shows how steady it is\.$/);
  assert.doesNotMatch(trialLine({ ...report, sameModel: 0 }), /same model/);
});

test('a run gives up once its first calls all went unanswered, never after one answered', () => {
  assert.equal(trialGivesUp([{ kind: 'failed' }], 2), false);
  assert.equal(trialGivesUp([{ kind: 'failed' }, { kind: 'failed' }], 2), true);
  assert.equal(trialGivesUp([{ kind: 'unparsed', ms: 1 }, { kind: 'failed' }, { kind: 'failed' }], 2), false);
});
