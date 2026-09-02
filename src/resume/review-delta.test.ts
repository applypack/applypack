import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deltaSentence, reviewDelta, type ReviewSnapshot } from './review-delta';

const base: ReviewSnapshot = {
  score: 45,
  version: 4,
  promptVersion: 2,
  grades: [
    { dimension: 'first_impression', grade: 'ok' },
    { dimension: 'impact', grade: 'weak' },
    { dimension: 'seniority_signal', grade: 'ok' },
    { dimension: 'clarity', grade: 'weak' },
    { dimension: 'keyword_coverage', grade: 'strong' },
    { dimension: 'polish', grade: 'ok' },
  ],
};

const improved: ReviewSnapshot = {
  ...base,
  score: 70,
  version: 5,
  grades: base.grades.map((g) =>
    g.dimension === 'impact' ? { ...g, grade: 'ok' as const } : g.dimension === 'clarity' ? { ...g, grade: 'strong' as const } : g,
  ),
};

describe('reviewDelta', () => {
  it('is null with no earlier run — the card then shows the score alone', () => {
    assert.equal(reviewDelta(null, improved), null);
  });

  it('is null when the earlier run has no grades to compare', () => {
    assert.equal(reviewDelta({ ...base, grades: [] }, improved), null);
  });

  it('names every dimension that moved, and which way', () => {
    const d = reviewDelta(base, improved);
    assert.equal(d?.points, 25);
    assert.deepEqual(
      d?.moves.map((m) => [m.dimension, m.from, m.to, m.up]),
      [
        ['impact', 'weak', 'ok', true],
        ['clarity', 'weak', 'strong', true],
      ],
    );
  });

  it('reports a fall as a fall', () => {
    const d = reviewDelta(improved, base);
    assert.equal(d?.points, -25);
    assert.equal(d?.moves.every((m) => m.up === false), true);
  });

  it('a re-run of the same text is marked as such', () => {
    const d = reviewDelta(base, { ...base, score: 48 });
    assert.equal(d?.sameVersion, true);
    assert.equal(d?.moves.length, 0);
  });

  it('two rubric versions are not a measurement', () => {
    const d = reviewDelta({ ...base, promptVersion: 1 }, improved);
    assert.equal(d?.incomparable, true);
  });

  it('a dimension the newer run did not grade is not a move', () => {
    const partial = { ...improved, grades: improved.grades.filter((g) => g.dimension !== 'impact') };
    const d = reviewDelta(base, partial);
    assert.deepEqual(d?.moves.map((m) => m.dimension), ['clarity']);
  });
});

describe('deltaSentence', () => {
  it('leads with the number and says what moved', () => {
    const s = deltaSentence(reviewDelta(base, improved)!);
    assert.match(s, /Strength 45 → 70, up 25/);
    assert.match(s, /2 dimensions moved/);
  });

  it('says "no change" out loud rather than going silent', () => {
    const s = deltaSentence(reviewDelta(base, { ...base })!);
    assert.match(s, /unchanged from the last review/);
    assert.match(s, /no dimension changed grade/);
    assert.match(s, /same text, re-judged/);
  });

  it('warns instead of comparing across rubric versions', () => {
    const s = deltaSentence(reviewDelta({ ...base, promptVersion: 1 }, improved)!);
    assert.match(s, /not a measurement/);
  });

  it('uses the singular for one moved dimension', () => {
    const one = { ...base, score: 50, grades: base.grades.map((g) => (g.dimension === 'polish' ? { ...g, grade: 'strong' as const } : g)) };
    assert.match(deltaSentence(reviewDelta(base, one)!), /1 dimension moved/);
  });
});
