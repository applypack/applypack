import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capExplanation,
  REVIEW_DIMENSIONS,
  REVIEW_WEIGHT_TOTAL,
  scoreReview,
  type ReviewDimension,
  type ReviewGrade,
  type ReviewGradeEntry,
} from './review-score';

/** All six dimensions at one grade, then the named overrides. */
function grades(base: ReviewGrade, over: Partial<Record<ReviewDimension, ReviewGrade>> = {}): ReviewGradeEntry[] {
  return REVIEW_DIMENSIONS.map((dimension) => ({ dimension, grade: over[dimension] ?? base }));
}

test('the weights add up to the score they claim to be out of', () => {
  assert.equal(REVIEW_WEIGHT_TOTAL, 100);
});

test('strong everywhere is 100, ok everywhere is half, weak everywhere is 0', () => {
  assert.equal(scoreReview(grades('strong')).score, 100);
  assert.equal(scoreReview(grades('ok')).score, 50);
  assert.equal(scoreReview(grades('weak')).score, 0);
});

test('gotcha 11: a duties-only resume cannot score high however polished', () => {
  // Everything a writer can control is strong; only the outcomes are missing.
  const bd = scoreReview(grades('strong', { impact: 'weak' }));
  assert.equal(bd.rawPts, 70, 'weights alone would have said 70');
  assert.equal(bd.cap, 55);
  assert.equal(bd.capReason, 'impact');
  assert.equal(bd.score, 55);
});

test('a duties-only resume that is also unremarkable lands far below the cap', () => {
  const bd = scoreReview(grades('ok', { impact: 'weak' }));
  assert.equal(bd.score, 35, `35, not the 55 cap: ${bd.rawPts} raw`);
  assert.equal(bd.cap, 55, 'the cap is recorded even when the raw score is under it');
});

test('two weak dimensions cap harder than one', () => {
  const bd = scoreReview(grades('strong', { clarity: 'weak', polish: 'weak' }));
  assert.equal(bd.weakCount, 2);
  assert.equal(bd.cap, 45);
  assert.equal(bd.capReason, 'two-weak');
  assert.equal(bd.score, 45);
});

test('weak impact plus a second weak dimension takes the harder cap', () => {
  const bd = scoreReview(grades('strong', { impact: 'weak', seniority_signal: 'weak' }));
  assert.equal(bd.cap, 45);
  assert.equal(bd.score, 45);
});

test('one weak dimension that is not impact does not cap at all', () => {
  const bd = scoreReview(grades('strong', { polish: 'weak' }));
  assert.equal(bd.cap, null);
  assert.equal(bd.score, 95);
});

test('a dimension the reply skipped earns nothing and still counts as weak', () => {
  const bd = scoreReview(grades('strong').filter((g) => g.dimension !== 'impact'));
  assert.deepEqual(bd.missing, ['impact']);
  assert.equal(bd.points.impact, 0);
  assert.equal(bd.cap, 55, 'an ungraded impact is not a pass');
  assert.equal(bd.score, 55);
});

test('an empty reply scores zero rather than dividing by nothing', () => {
  const bd = scoreReview([]);
  assert.equal(bd.score, 0);
  assert.equal(bd.missing.length, REVIEW_DIMENSIONS.length);
});

test('the first grade for a dimension wins, so a repeated row cannot double-count', () => {
  const bd = scoreReview([
    { dimension: 'impact', grade: 'strong' },
    { dimension: 'impact', grade: 'weak' },
  ]);
  assert.equal(bd.points.impact, 30);
});

test('per-dimension points are reported, not just the total', () => {
  const bd = scoreReview(grades('ok'));
  assert.equal(bd.points.impact, 15);
  assert.equal(bd.points.polish, 2.5);
  assert.equal(bd.max, 100);
});

test('a cap always comes with words for it', () => {
  assert.equal(capExplanation(scoreReview(grades('strong'))), null);
  assert.match(capExplanation(scoreReview(grades('strong', { impact: 'weak' })))!, /duties rather than outcomes/);
  assert.match(capExplanation(scoreReview(grades('weak')))!, /6 dimensions came back weak/);
});
