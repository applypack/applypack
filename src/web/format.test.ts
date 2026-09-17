import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FIT_INFO_FLOOR, FIT_OK_FLOOR, FIT_WARN_FLOOR, fitTone, fitWord, formatUntil } from './format';

describe('formatUntil', () => {
  it('counts forward, in the units a reader wants', () => {
    const now = Date.now();
    assert.equal(formatUntil(new Date(now + 30_000)), 'in 30s');
    assert.equal(formatUntil(new Date(now + 20 * 60_000)), 'in 20m');
    assert.equal(formatUntil(new Date(now + 22 * 3_600_000)), 'in 22h');
    assert.equal(formatUntil(new Date(now + 6 * 24 * 3_600_000)), 'in 6d');
  });

  // The bug this pins: formatRelative rendered a future nextCheckAt as
  // "-85937s ago" on the watchlist.
  it('says "due now" for a time that has passed, never a negative age', () => {
    assert.equal(formatUntil(new Date(Date.now() - 86_400_000)), 'due now');
    assert.equal(formatUntil(new Date(Date.now() - 1)), 'due now');
  });

  it('has an em dash for nothing', () => {
    assert.equal(formatUntil(null), '—');
    assert.equal(formatUntil(undefined), '—');
  });
});

describe('fitWord', () => {
  it('says the tone floors in a word, on the same cut-offs as fitTone', () => {
    assert.equal(fitWord(FIT_OK_FLOOR), 'Strong');
    assert.equal(fitWord(FIT_OK_FLOOR - 1), 'Good');
    assert.equal(fitWord(FIT_INFO_FLOOR), 'Good');
    assert.equal(fitWord(FIT_INFO_FLOOR - 1), 'Partial');
    assert.equal(fitWord(FIT_WARN_FLOOR), 'Partial');
    assert.equal(fitWord(FIT_WARN_FLOOR - 1), 'Weak');
    assert.equal(fitWord(0), 'Weak');
    assert.equal(fitWord(null), '');
  });

  it('never parts ways with the tone', () => {
    const wordOf = { ok: 'Strong', info: 'Good', warn: 'Partial', neutral: 'Weak' } as const;
    for (let score = 0; score <= 100; score++) {
      assert.equal(fitWord(score), wordOf[fitTone(score) as keyof typeof wordOf], `score ${score}`);
    }
  });
});

