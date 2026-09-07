import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignmentDrift, attribute, modeOf, spreadOf, statusDrift, type VarianceRun } from './variance';
import type { MatchAlignment, ScoreBreakdown } from './score';

const STRONG: MatchAlignment = { title: 'strong', summary: 'strong', recent_role: 'strong' };

const run = (over: {
  keywordPts?: number;
  alignmentPts?: number;
  penalty?: number;
  cap?: number | null;
  alignment?: MatchAlignment;
  keywords?: { term: string; status: 'present' | 'add' | 'ask_user' | 'cannot_claim' }[];
}): VarianceRun => {
  const breakdown = {
    v: 4,
    keywordPts: over.keywordPts ?? 40,
    keywordMax: 60,
    keywordEarned: 0,
    keywordTotal: 0,
    alignmentPts: over.alignmentPts ?? 30,
    alignmentMax: 40,
    penalty: over.penalty ?? 0,
    primaryTotal: 1,
    primaryPresent: 1,
    cap: over.cap ?? null,
    score: 0,
    alignment: over.alignment ?? STRONG,
  } as ScoreBreakdown;
  const score =
    breakdown.cap === null
      ? Math.round(breakdown.keywordPts + breakdown.alignmentPts - breakdown.penalty)
      : Math.min(breakdown.cap, Math.round(breakdown.keywordPts + breakdown.alignmentPts - breakdown.penalty));
  return { score, breakdown: { ...breakdown, score }, keywords: over.keywords ?? [], redFlags: 0, actions: 0 };
};

test('spreadOf reports the shape of a set of runs', () => {
  assert.deepEqual(spreadOf([70, 75, 80]), { min: 70, max: 80, mean: 75, sd: 4.1, spread: 10 });
  assert.deepEqual(spreadOf([50, 50]), { min: 50, max: 50, mean: 50, sd: 0, spread: 0 });
  assert.equal(spreadOf([]).spread, 0);
});

test('modeOf picks the most common value, ties going to run order', () => {
  assert.equal(modeOf(['a', 'b', 'a']), 'a');
  assert.equal(modeOf([null, 30, null]), null);
  assert.equal(modeOf(['x', 'y']), 'x');
  assert.equal(modeOf([]), undefined);
});

test('attribution names the part a spread came from', () => {
  // Alignment is the only thing moving: hold it still and the spread is gone.
  const runs = [run({ alignmentPts: 40 }), run({ alignmentPts: 20 }), run({ alignmentPts: 40 })];
  const { total, parts } = attribute(runs);
  assert.equal(total, 20);
  assert.equal(parts[0]?.part, 'alignment');
  assert.equal(parts[0]?.share, 1);
  assert.equal(parts[0]?.spreadWithout, 0);
  // Nothing else accounts for any of it.
  assert.deepEqual(parts.slice(1).map((p) => p.share), [0, 0, 0]);
});

test('a cap that fires in one run of three is attributed to the cap', () => {
  const runs = [run({}), run({ cap: 30 }), run({})];
  const { parts } = attribute(runs);
  assert.equal(parts[0]?.part, 'cap');
  assert.equal(parts[0]?.spreadWithout, 0);
});

test('alignmentDrift counts the runs that disagreed with the majority', () => {
  const runs = [
    run({ alignment: STRONG }),
    run({ alignment: { ...STRONG, recent_role: 'partial' } }),
    run({ alignment: STRONG }),
  ];
  const drift = alignmentDrift(runs);
  assert.deepEqual(drift.map((d) => d.differed), [0, 0, 1]);
  assert.equal(drift[2]?.mode, 'strong');
});

test('statusDrift puts the terms the model changed its mind about first', () => {
  const runs = [
    run({ keywords: [{ term: 'React', status: 'present' }, { term: 'Rust', status: 'cannot_claim' }] }),
    run({ keywords: [{ term: 'React', status: 'add' }, { term: 'Rust', status: 'cannot_claim' }] }),
  ];
  const drift = statusDrift(runs);
  assert.equal(drift[0]?.term, 'React');
  assert.equal(drift[0]?.stable, false);
  assert.deepEqual(drift[0]?.statuses, ['present', 'add']);
  assert.equal(drift[1]?.stable, true);
  // A term one run did not return at all reads as absent, not as a crash.
  const patchy = statusDrift([runs[0]!, run({ keywords: [] })]);
  assert.deepEqual(patchy.find((d) => d.term === 'React')?.statuses, ['present', '-']);
});
