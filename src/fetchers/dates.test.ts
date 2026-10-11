import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapBambooFeed } from './bamboohr';
import { clockDated, markClockDated, safeDate, validDate } from './dates';
import { mapGreenhouseJob } from './greenhouse';

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

// #379: "published recently" must not be read off a date the clock wrote.
test('clockDated: a date at or after the moment the read began is the clock\'s', () => {
  const began = Date.parse('2026-10-11T10:00:00Z');
  assert.equal(clockDated(new Date(began - 1), began), false);
  assert.equal(clockDated(new Date('2026-10-11T09:59:00Z'), began), false);
  assert.equal(clockDated(new Date('2020-01-01T00:00:00Z'), began), false);
  assert.equal(clockDated(new Date(began), began), true);
  assert.equal(clockDated(new Date(began + 4_000), began), true);
  // A source whose clock runs ahead: its date is not one to hold it to.
  assert.equal(clockDated(new Date('2026-10-12T00:00:00Z'), began), true);
  // An invalid date is neither; process-jobs replaces it and marks it there.
  assert.equal(clockDated(new Date('nope'), began), false);
});

test('markClockDated: what the mappers fall back to is marked, a date the source gave is not', () => {
  const began = Date.now();
  // safeDate with nothing to read, as thirty mappers call it.
  const fallen: { postedAt: Date; undated?: boolean }[] = [{ postedAt: safeDate(undefined) }, { postedAt: safeDate('garbage') }, { postedAt: validDate(new Date('nope')) }];
  const given: { postedAt: Date; undated?: boolean }[] = [{ postedAt: safeDate('2026-10-09T08:00:00Z') }, { postedAt: new Date(began - 60_000) }];
  markClockDated(fallen, began);
  markClockDated(given, began);
  assert.deepEqual(fallen.map((j) => j.undated), [true, true, true]);
  assert.deepEqual(given.map((j) => 'undated' in j), [false, false]);
  // A mapper that said so itself is not unsaid by a date that looks real (a row dated by its file).
  const said = [{ postedAt: new Date(began - 86_400_000), undated: true }];
  markClockDated(said, began);
  assert.equal(said[0]!.undated, true);
});

test('markClockDated over two real mappers: a board that publishes no dates, and one that dates every job', () => {
  const began = Date.now();
  const bamboo = mapBambooFeed({ result: [{ id: '7', jobOpeningName: 'Backend Developer', location: { city: 'Lisbon', state: null }, isRemote: true }] }, 1, 'quince');
  const greenhouse = [
    mapGreenhouseJob({ id: 1, title: 'Backend Developer', location: { name: 'Remote' }, content: 'x', absolute_url: 'https://boards.greenhouse.io/fennel/jobs/1', updated_at: '2026-10-09T08:00:00Z', departments: [], offices: [] }, 2),
    // A date that does not parse falls back to now, on this board as on any.
    mapGreenhouseJob({ id: 2, title: 'Backend Developer', location: { name: 'Remote' }, content: 'x', absolute_url: 'https://boards.greenhouse.io/fennel/jobs/2', updated_at: 'soon', departments: [], offices: [] }, 2),
  ];
  markClockDated(bamboo, began);
  markClockDated(greenhouse, began);
  assert.deepEqual(bamboo.map((j) => j.undated), [true]);
  assert.deepEqual(greenhouse.map((j) => j.undated === true), [false, true]);
});
