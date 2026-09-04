import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  currencyOf,
  formatSalaryRange,
  formatUsdPerYear,
  isCurrencyCode,
  isSalaryPeriod,
  periodOf,
  toUsdPerYear,
} from './currency';

describe('reading what was stored', () => {
  it('treats a missing or unknown currency as USD and a missing period as a year', () => {
    assert.equal(currencyOf(null), 'USD');
    assert.equal(currencyOf('eur'), 'EUR');
    assert.equal(currencyOf('XYZ'), 'USD');
    assert.equal(periodOf(null), 'year');
    assert.equal(periodOf('month'), 'month');
    assert.equal(periodOf('fortnight'), 'year');
    assert.equal(isCurrencyCode('pln'), true);
    assert.equal(isCurrencyCode('XYZ'), false);
    assert.equal(isSalaryPeriod('hour'), true);
    assert.equal(isSalaryPeriod('yearly'), false);
  });
});

describe('toUsdPerYear', () => {
  it('converts the money and the period in one step', () => {
    assert.equal(toUsdPerYear(100_000, 'USD', 'year'), 100_000);
    assert.equal(toUsdPerYear(60_000, 'EUR', 'year'), 69_714);
    // solid.jobs quotes PLN a month: 20 200 zł/mo is a real senior salary.
    assert.equal(toUsdPerYear(20_200, 'PLN', 'month'), 65_157);
    // An hourly rate is a working year (1 760 h), never 8 760.
    assert.equal(toUsdPerYear(80, 'USD', 'hour'), 140_800);
    assert.equal(toUsdPerYear(500, 'GBP', 'day'), 148_687);
  });

  it('answers null for anything that is not a positive number', () => {
    assert.equal(toUsdPerYear(null, 'EUR', 'year'), null);
    assert.equal(toUsdPerYear(0, 'EUR', 'year'), null);
    assert.equal(toUsdPerYear(Number.NaN, 'EUR', 'year'), null);
    assert.equal(toUsdPerYear(-5, 'EUR', 'year'), null);
  });
});

describe('formatSalaryRange', () => {
  it('shows the posting\'s own money and period', () => {
    assert.equal(formatSalaryRange(140_000, 180_000, 'USD', 'year'), '$140k-180k');
    assert.equal(formatSalaryRange(60_000, 80_000, 'EUR', 'year'), '€60k-80k');
    assert.equal(formatSalaryRange(20_200, 27_600, 'PLN', 'month'), 'zł20k-28k/mo');
    assert.equal(formatSalaryRange(17_500, 35_000, 'GBP'), '£18k-35k');
    assert.equal(formatSalaryRange(85, null, 'USD', 'hour'), '$85+/hr');
    assert.equal(formatSalaryRange(null, 90_000, 'CHF', 'year'), 'up to CHF 90k');
    assert.equal(formatSalaryRange(150_000, 150_000, 'USD', 'year'), '$150k');
  });

  it('falls back to USD a year when the columns say nothing, and to a dash when there is no number', () => {
    assert.equal(formatSalaryRange(140_000, 180_000, null, null), '$140k-180k');
    assert.equal(formatSalaryRange(null, null, 'EUR', 'year'), '—');
    assert.equal(formatSalaryRange(0, null, 'EUR', 'year'), '—');
  });
});

describe('formatUsdPerYear', () => {
  it('adds a comparable number only when the posting is not already USD a year', () => {
    assert.equal(formatUsdPerYear(60_000, 80_000, 'EUR', 'year'), '≈ $93k/yr');
    assert.equal(formatUsdPerYear(20_200, 27_600, 'PLN', 'month'), '≈ $89k/yr');
    assert.equal(formatUsdPerYear(140_000, 180_000, 'USD', 'year'), '');
    assert.equal(formatUsdPerYear(85, null, 'USD', 'hour'), '≈ $150k/yr');
    assert.equal(formatUsdPerYear(null, null, 'EUR', 'year'), '');
  });
});
