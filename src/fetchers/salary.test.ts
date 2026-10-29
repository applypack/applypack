import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeText, salaryLine } from './salary';

test('rangeText: both bounds, one, the same twice, or nothing a number', () => {
  assert.equal(rangeText(60000, 80000), '60000-80000');
  assert.equal(rangeText(60000, null), 'from 60000');
  assert.equal(rangeText(undefined, 80000), 'up to 80000');
  assert.equal(rangeText(134000, 134000), '134000');
  assert.equal(rangeText(0, 0), null);
  assert.equal(rangeText(Number.NaN, -5), null);
});

test('salaryLine: the line the classifier reads, its currency and period when given', () => {
  assert.equal(salaryLine(82550, 99000, 'USD', 'year'), 'Salary: 82550-99000 USD (year).');
  assert.equal(salaryLine(200000, null, ' USD ', ''), 'Salary: from 200000 USD.');
  assert.equal(salaryLine(null, null, 'USD', 'year'), null);
});
