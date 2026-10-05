import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIT_INFO_FLOOR,
  FIT_OK_FLOOR,
  FIT_WARN_FLOOR,
  fitTone,
  fitWord,
  formatDate,
  formatDateShort,
  formatDuration,
  formatRelative,
  formatStamp,
  formatTime,
  formatUntil,
  safeHref,
  statusLabel,
} from './format';
import { displayZoneLabel, withDisplayZone } from './display-zone';
import { withLocale } from '../i18n/locale';

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

describe('safeHref', () => {
  it('lets through http(s) and nothing else', () => {
    assert.equal(safeHref('https://acme.example/jobs/1'), 'https://acme.example/jobs/1');
    assert.equal(safeHref(' http://acme.example '), 'http://acme.example/');
    assert.equal(safeHref('javascript:alert(1)'), null);
    assert.equal(safeHref('data:text/html,hi'), null);
    assert.equal(safeHref('/relative'), null);
    assert.equal(safeHref(null), null);
    assert.equal(safeHref(''), null);
  });
});

describe('formatDuration', () => {
  it('writes milliseconds, then seconds and minutes to one decimal', () => {
    assert.equal(formatDuration(250), '250ms');
    assert.equal(formatDuration(1500), '1.5s');
    assert.equal(formatDuration(59_960), '60.0s');
    assert.equal(formatDuration(90_000), '1.5m');
    assert.equal(formatDuration(72_000_000), '1200.0m');
    assert.equal(formatDuration(null), '—');
  });
});

// ADR 0061: the same helpers in another language of the interface.
describe('in Ukrainian', () => {
  const uk = <T>(fn: () => T): T => withLocale('uk', fn);
  const noonUtc = new Date('2026-09-25T12:00:00Z');

  it('writes dates as Ukrainian does, in the zone of the request', () => {
    assert.equal(plain(uk(() => withDisplayZone('Europe/Kyiv', () => formatDate(noonUtc)))), '25 вер. 2026 р., 15:00 GMT+3');
    assert.equal(uk(() => withDisplayZone('Europe/Kyiv', () => formatStamp(noonUtc))), '25 вер., 15:00');
    assert.equal(uk(() => formatDateShort(noonUtc)), '25 вер.');
    assert.equal(uk(() => formatTime(noonUtc)), '12:00');
  });

  it('words how long ago and how soon', () => {
    const now = Date.now();
    assert.equal(uk(() => formatRelative(new Date(now - 5 * 60_000))), '5 хв тому');
    assert.equal(uk(() => formatRelative(new Date(now - 3 * 86_400_000))), '3 дн. тому');
    assert.equal(uk(() => formatUntil(new Date(now + 22 * 3_600_000))), 'за 22 год');
    assert.equal(uk(() => formatUntil(new Date(now - 1))), 'на черзі');
  });

  it('writes a duration with the comma Ukrainian uses', () => {
    assert.equal(uk(() => formatDuration(1500)), '1,5 с');
    assert.equal(uk(() => formatDuration(250)), '250 мс');
  });

  it('names a status and a fit floor', () => {
    assert.equal(uk(() => statusLabel('APPLIED')), 'Подано');
    assert.equal(statusLabel('APPLIED'), 'Applied');
    assert.equal(uk(() => fitWord(FIT_OK_FLOOR)), 'Сильна');
  });
});
