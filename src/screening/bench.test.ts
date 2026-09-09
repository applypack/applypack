import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateConfusion, kendallTau, parseRanking, precisionAtK, stability } from './bench';

test('kendallTau: identical, reversed, one swap, missing items', () => {
  assert.equal(kendallTau(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']), 1);
  assert.equal(kendallTau(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a']), -1);
  assert.equal(kendallTau(['a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd']), 0.67);
  assert.equal(kendallTau(['a', 'b', 'c'], ['c', 'a', 'x']), -1, 'b is left out; a above c in one order, below in the other');
  assert.equal(kendallTau(['a'], ['a']), null);
});

test('precisionAtK, gateConfusion, stability, parseRanking', () => {
  assert.deepEqual(precisionAtK(['a', 'b', 'c', 'd'], ['b', 'x', 'a', 'd'], 3), { hit: 2, k: 3 });
  const g = gateConfusion([
    { expected: 'pass', got: 'pass' },
    { expected: 'pass', got: 'unknown' },
    { expected: 'fail', got: 'fail' },
    { expected: 'unknown', got: 'pass' },
  ]);
  assert.equal(g.agree, 2);
  assert.equal(g.matrix.pass.unknown, 1);
  assert.equal(g.matrix.unknown.pass, 1);
  const s = stability({ a: 60, b: 70, c: 50 }, { a: 63, b: 62, d: 1 });
  assert.deepEqual([s.mean, s.max, s.moved.map((m) => m.id)], [5.5, 8, ['b', 'a']]);
  assert.deepEqual(stability({}, {}), { mean: null, max: null, moved: [] });
  assert.deepEqual(parseRanking('# best first\n03-hanna.md\n\n01-olena.md # strong too\n'), ['03-hanna.md', '01-olena.md']);
});
