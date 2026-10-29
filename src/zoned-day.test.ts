import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayIn, dayMarker, dayStart, parseDay, parsePastDay } from './zoned-day';

test('a date is the day it fell on in the reader\'s time zone', () => {
  const late = new Date('2026-09-01T22:30:00Z');
  assert.equal(dayIn(late, 'UTC'), '2026-09-01');
  assert.equal(dayIn(late, 'Europe/Kyiv'), '2026-09-02');
  assert.equal(dayIn(null, 'UTC'), '');
  assert.equal(dayMarker(late, 'Europe/Kyiv').toISOString(), '2026-09-02T00:00:00.000Z');
});

test("a day begins at the zone's own midnight, a clock change included (#680)", () => {
  assert.equal(dayStart('2026-10-28', 'America/Chicago').toISOString(), '2026-10-28T05:00:00.000Z');
  assert.equal(dayStart('2026-10-29', 'Europe/Kyiv').toISOString(), '2026-10-28T22:00:00.000Z', 'winter time, UTC+2');
  assert.equal(dayStart(new Date('2026-10-29T00:00:00Z'), 'Europe/Kyiv').toISOString(), '2026-10-28T22:00:00.000Z', 'a DATE marker');
  // Kyiv leaves summer time at 04:00 on 10-25: that day still begins at 00:00 summer time.
  assert.equal(dayStart('2026-10-25', 'Europe/Kyiv').toISOString(), '2026-10-24T21:00:00.000Z');
  assert.equal(dayStart('2026-10-26', 'Europe/Kyiv').toISOString(), '2026-10-25T22:00:00.000Z');
  for (const zone of ['UTC', 'America/Chicago', 'Europe/Kyiv', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    assert.equal(dayIn(dayStart('2026-10-28', zone), zone), '2026-10-28', zone);
  }
});

test('parseDay takes a calendar day and nothing else', () => {
  assert.equal(parseDay('2026-10-28'), '2026-10-28');
  assert.equal(parseDay(' 2026-10-28 '), '2026-10-28');
  for (const no of ['2026-02-30', '+099999-01-01', 'yesterday', '2026-1-5', '']) assert.equal(parseDay(no), null, no);
});

test('an apply day is one that has come, from 1990 to today where the dashboard reads dates (#682)', () => {
  const now = new Date('2026-10-29T05:00:00Z'); // 10-28 evening in Honolulu
  assert.equal(parsePastDay('2026-10-28', now, 'Pacific/Honolulu'), '2026-10-28');
  assert.equal(parsePastDay('2026-10-29', now, 'Pacific/Honolulu'), null, 'tomorrow there');
  assert.equal(parsePastDay('2026-10-29', now, 'Europe/Kyiv'), '2026-10-29');
  assert.equal(parsePastDay('1990-01-01', now, 'UTC'), '1990-01-01');
  for (const no of ['1989-12-31', '+099999-01-01', '-200000-01-01', '2026-02-30', 'yesterday']) assert.equal(parsePastDay(no, now, 'UTC'), null, no);
});
