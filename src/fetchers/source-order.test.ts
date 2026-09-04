import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shuffleSources, tickSeed } from './source-order';

const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('shuffleSources', () => {
  it('keeps every source exactly once', () => {
    const input = ids(62);
    const out = shuffleSources(input, 12345);
    assert.equal(out.length, input.length);
    assert.deepEqual([...out].sort((a, b) => a - b), input);
  });

  it('does not touch the caller’s array', () => {
    const input = ids(10);
    shuffleSources(input, 7);
    assert.deepEqual(input, ids(10));
  });

  it('is deterministic for a seed and different across seeds', () => {
    assert.deepEqual(shuffleSources(ids(30), 99), shuffleSources(ids(30), 99));
    assert.notDeepEqual(shuffleSources(ids(30), 99), shuffleSources(ids(30), 100));
  });

  it('does not leave the first source first', () => {
    // The whole point: source #1 must stop being everyone's first request.
    const first = ids(62).map((_, i) => shuffleSources(ids(62), i * 7919)[0]);
    const stillFirst = first.filter((id) => id === 1).length;
    assert.ok(stillFirst <= 3, `source 1 led ${stillFirst} of ${first.length} ticks`);
  });

  it('spreads one source over the whole walk across ticks', () => {
    const positions = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      positions.add(shuffleSources(ids(62), seed).indexOf(1));
    }
    assert.ok(positions.size > 40, `source 1 only ever took ${positions.size} positions`);
  });

  it('handles the degenerate sizes', () => {
    assert.deepEqual(shuffleSources([], 1), []);
    assert.deepEqual(shuffleSources(['only'], 1), ['only']);
  });
});

describe('tickSeed', () => {
  it('is an integer — a float would collapse to seed 0 and freeze the order', () => {
    // mulberry32 does `seed >>> 0`, so Math.random() straight from the box
    // would give every tick the same permutation and silently undo this.
    assert.notDeepEqual(shuffleSources(ids(30), 0.4), shuffleSources(ids(30), 7));
    for (let i = 0; i < 100; i++) {
      const seed = tickSeed();
      assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32, `${seed}`);
    }
  });
});
