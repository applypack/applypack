import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FIT_INFO_FLOOR, FIT_OK_FLOOR, FIT_WARN_FLOOR, fitTone, fitWord, formatDate, formatDateShort, formatStamp, formatUntil } from './format';
import { displayZoneLabel, withDisplayZone } from './display-zone';

/** ICU writes a narrow no-break space before AM/PM; the tests read plain spaces. */
const plain = (s: string): string => s.replace(/\s/g, ' ');

describe('formatDate', () => {
  const noonUtc = new Date('2026-09-25T12:00:00Z');

  // Every date used to be written in America/Chicago, whatever the install's
  // zone: a Kyiv user read 07:00 AM for a tick at 15:00.
  it('writes the moment in the zone of the request, and names the zone', () => {
    assert.equal(plain(withDisplayZone('Europe/Kyiv', () => formatDate(noonUtc))), 'Sep 25, 2026, 03:00 PM GMT+3');
    assert.equal(plain(withDisplayZone('America/Chicago', () => formatDate(noonUtc))), 'Sep 25, 2026, 07:00 AM CDT');
  });

  it('reads UTC outside a request', () => {
    assert.equal(plain(formatDate(noonUtc)), 'Sep 25, 2026, 12:00 PM UTC');
  });

  it('puts a short date on the day it is in that zone', () => {
    const lateUtc = new Date('2026-09-25T23:30:00Z');
    assert.equal(withDisplayZone('Europe/Kyiv', () => formatDateShort(lateUtc)), 'Sep 26');
    assert.equal(formatDateShort(lateUtc), 'Sep 25');
  });

  it('has an em dash for nothing', () => {
    assert.equal(formatDate(null), '—');
    assert.equal(formatDateShort(undefined), '—');
  });

  // A table cell has room for the day and the time; the header names the zone once.
  it('writes a table stamp as day and 24-hour time, and the zone as a header label', () => {
    assert.equal(withDisplayZone('Europe/Kyiv', () => formatStamp(noonUtc)), 'Sep 25, 15:00');
    assert.equal(withDisplayZone('Europe/Kyiv', () => displayZoneLabel(noonUtc)), 'GMT+3');
    assert.equal(withDisplayZone('America/Chicago', () => displayZoneLabel(noonUtc)), 'CDT');
    assert.equal(displayZoneLabel(noonUtc), 'UTC');
  });
});

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

