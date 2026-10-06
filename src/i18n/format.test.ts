import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDatePart, formatDateRange, formatDateTime, formatList, formatNumber, regionName, weekdayName } from './format';
import { PSEUDO_LOCALE, withLocale } from './locale';

/** ICU separates with no-break and narrow no-break spaces; the tests read plain ones. */
const plain = (s: string): string => s.replace(/\s/g, ' ');
const inUk = <T>(fn: () => T): T => withLocale('uk', fn);

describe('formatNumber', () => {
  it('groups as the language does, in Latin digits', () => {
    assert.equal(formatNumber(1234567.5), '1,234,567.5');
    assert.equal(plain(inUk(() => formatNumber(1234567.5))), '1 234 567,5');
    assert.equal(inUk(() => formatNumber(0.5, { style: 'percent' })).replace(/\s/g, ''), '50%');
  });
});

describe('formatDateTime', () => {
  const noonUtc = new Date('2026-09-25T12:00:00Z');
  const full = { timeZone: 'Europe/Kyiv', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } as const;

  it('writes a moment as the language writes dates, in the zone given', () => {
    assert.equal(plain(formatDateTime(noonUtc, full)), 'Sep 25, 2026, 03:00 PM GMT+3');
    assert.equal(plain(inUk(() => formatDateTime(noonUtc, full))), '25 вер. 2026 р., 15:00 GMT+3');
  });

  it('reads one part out of a date', () => {
    assert.equal(formatDatePart(noonUtc, { timeZone: 'America/Chicago', timeZoneName: 'short' }, 'timeZoneName'), 'CDT');
    assert.equal(formatDatePart(noonUtc, { timeZone: 'UTC', year: 'numeric' }, 'timeZoneName'), null);
  });
});

describe('formatDateRange', () => {
  const day = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
  const range = (from: string, to: string) => formatDateRange(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`), day);

  it('writes a span of days as the language does', () => {
    assert.equal(plain(range('2026-09-16', '2026-09-18')), 'Sep 16 – 18');
    assert.equal(plain(range('2026-09-29', '2026-10-01')), 'Sep 29 – Oct 1');
    assert.equal(plain(inUk(() => range('2026-09-16', '2026-09-18'))), '16–18 вер.');
  });

  it('adds no year the options left out when the span crosses New Year', () => {
    assert.equal(plain(range('2025-12-30', '2026-01-01')), 'Dec 30 – Jan 1');
    assert.equal(plain(inUk(() => range('2025-12-30', '2026-01-01'))), '30 груд. – 1 січ.');
  });
});

describe('formatList', () => {
  it('joins with the language\'s own "and" and "or"', () => {
    assert.equal(formatList(['PHP', 'Laravel', 'Vue']), 'PHP, Laravel, and Vue');
    assert.equal(formatList(['PHP', 'Laravel'], 'disjunction'), 'PHP or Laravel');
    assert.equal(inUk(() => formatList(['PHP', 'Laravel', 'Vue'])), 'PHP, Laravel і Vue');
    assert.equal(inUk(() => formatList(['PHP', 'Laravel'], 'disjunction')), 'PHP або Laravel');
    assert.equal(formatList(['PHP']), 'PHP');
    assert.equal(formatList([]), '');
  });
});

describe('weekdayName', () => {
  it('names ISO weekdays, Monday first', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((d) => weekdayName(d)), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    assert.equal(weekdayName(7, 'long'), 'Sunday');
    assert.deepEqual(inUk(() => [1, 7].map((d) => weekdayName(d))), ['пн', 'нд']);
    assert.equal(inUk(() => weekdayName(3, 'long')), 'середа');
  });
});

describe('regionName', () => {
  it('keeps the gazetteer\'s own name in English', () => {
    assert.equal(regionName('US', 'USA'), 'USA');
  });

  it('is the language\'s name for the country elsewhere', () => {
    assert.equal(inUk(() => regionName('DE', 'Germany')), 'Німеччина');
    assert.equal(inUk(() => regionName('EU', 'European Union')), 'Європейський Союз');
  });

  it('falls back to the own name for a code that is not a country', () => {
    assert.equal(inUk(() => regionName('DACH', 'DACH')), 'DACH');
    assert.equal(inUk(() => regionName('EUROPE', 'Europe')), 'Europe');
    assert.equal(inUk(() => regionName('', 'Anywhere')), 'Anywhere');
  });
});

describe('under the pseudo-language', () => {
  it('marks what it wrote, so the scan does not take a date for hard-coded English', () => {
    const pseudo = <T>(fn: () => T): T => withLocale(PSEUDO_LOCALE, fn);
    assert.equal(pseudo(() => formatNumber(1200)), '⟦1,200⟧');
    assert.equal(pseudo(() => weekdayName(1)), '⟦Mon⟧');
    assert.equal(pseudo(() => formatList(['a', 'b'])), '⟦a and b⟧');
    assert.equal(pseudo(() => regionName('DE', 'Germany')), '⟦Germany⟧');
  });
});
