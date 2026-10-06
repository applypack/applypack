import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScoreBreakdown } from '../resume/score';
import { compareStop, DEFAULT_MIN_CEILING, livenessStop, verifyStop } from './gate';

const breakdown = (over: Partial<ScoreBreakdown> = {}): ScoreBreakdown => ({
  v: 6,
  keywordPts: 40,
  keywordMax: 60,
  keywordEarned: 40,
  keywordTotal: 60,
  alignmentPts: 30,
  alignmentMax: 40,
  penalty: 0,
  primaryTotal: 3,
  primaryPresent: 3,
  cap: null,
  score: 70,
  ceiling: 90,
  alignment: null,
  ...over,
});

const compare = (b: Partial<ScoreBreakdown>, hard: Parameters<typeof compareStop>[0]['hard'] = []) =>
  compareStop({ breakdown: breakdown(b), hard, minCeiling: DEFAULT_MIN_CEILING });

test('only a posting known to be gone stops before any AI', () => {
  assert.deepEqual(livenessStop({ liveness: 'expired', label: 'The board no longer lists it' }), {
    stop: 'closed',
    why: 'The board no longer lists it',
  });
  assert.equal(livenessStop({ liveness: 'uncertain', label: 'Could not check' }), null);
  assert.equal(livenessStop({ liveness: 'active', label: 'Listed' }), null);
});

test('the ceiling decides, not the score: a low score editing can lift goes on', () => {
  assert.equal(compare({ score: 44, ceiling: 88 }), null);
  assert.equal(compare({ score: 75, ceiling: 75 }), null);
});

test('a ceiling under the floor stops, and names the core stack when that is the reason', () => {
  assert.deepEqual(compare({ score: 30, ceiling: 49, primaryPresent: 1, primaryTotal: 4 }), {
    stop: 'low-ceiling',
    why: 'Editing can take this resume to 49 at most, under the floor of 75 — it shows 1 of the 4 core technologies',
  });
  assert.equal(compare({ score: 60, ceiling: 70 })?.why, 'Editing can take this resume to 70 at most, under the floor of 75');
});

test('a row stored before the ceiling existed is judged on its score', () => {
  assert.equal(compare({ score: 80, ceiling: undefined }), null);
  assert.equal(compare({ score: 60, ceiling: undefined })?.stop, 'low-ceiling');
});

test('a failed requirement stops whatever the ceiling; an unanswered one does not', () => {
  const stop = compare({ ceiling: 100 }, [
    { requirement: 'US work authorization', status: 'unknown', note: null },
    { requirement: 'Based in the EU', status: 'fail', note: 'the resume places the candidate in Texas' },
  ]);
  assert.deepEqual(stop, { stop: 'failed-gate', why: 'Based in the EU — the resume places the candidate in Texas' });
  assert.equal(compare({ ceiling: 100 }, [{ requirement: '5+ years', status: 'unknown', note: null }]), null);
  assert.equal(compare({ ceiling: 100 }, [{ requirement: 'A degree', status: 'fail', note: null }])?.why, 'A degree');
});

test('a fake stops, a skip stops, a caution goes on', () => {
  assert.equal(verifyStop({ verdict: 'fake', recommendation: 'skip', summary: 'Asks for payment' })?.stop, 'fake');
  assert.deepEqual(verifyStop({ verdict: 'legit', recommendation: 'skip', summary: 'Re-posted since March' }), {
    stop: 'skip',
    why: 'Re-posted since March',
  });
  assert.equal(verifyStop({ verdict: 'suspicious', recommendation: 'caution', summary: 'Thin footprint' }), null);
  assert.equal(verifyStop({ verdict: 'legit', recommendation: 'apply', summary: 'Listed on the careers page' }), null);
});
