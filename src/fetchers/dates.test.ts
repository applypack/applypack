import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeDate, validDate } from './dates';

test('safeDate reads what parses and falls back on the rest', () => {
  const fallback = new Date('2026-09-10T00:00:00Z');
  assert.equal(safeDate('Wed, 09 Sep 2026 10:00:00 GMT', fallback).toISOString(), '2026-09-09T10:00:00.000Z');
  assert.equal(safeDate(1757412000 * 1000, fallback).getTime(), 1757412000 * 1000);
  for (const bad of ['garbage', '', null, undefined, Infinity, 1e18]) {
    assert.equal(safeDate(bad as string, fallback), fallback, String(bad));
  }
});

test('validDate keeps a real date and replaces an invalid one', () => {
  const fallback = new Date('2026-09-10T00:00:00Z');
  const real = new Date('2026-01-01T00:00:00Z');
  assert.equal(validDate(real, fallback), real);
  assert.equal(validDate(new Date('nope'), fallback), fallback);
});
