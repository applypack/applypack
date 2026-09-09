import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRange, monthsSinceLatest, parseRange, parseResumeDate, yearsCovered } from './dates';

const NOW = new Date('2026-09-09T00:00:00Z');

test('parseResumeDate reads the shapes resumes write', () => {
  assert.deepEqual(parseResumeDate('Jan 2020'), { year: 2020, month: 1 });
  assert.deepEqual(parseResumeDate('January 2020'), { year: 2020, month: 1 });
  assert.deepEqual(parseResumeDate('Sept. 2019'), { year: 2019, month: 9 });
  assert.deepEqual(parseResumeDate('01/2020'), { year: 2020, month: 1 });
  assert.deepEqual(parseResumeDate('2020-03'), { year: 2020, month: 3 });
  assert.deepEqual(parseResumeDate('03.2019'), { year: 2019, month: 3 });
  assert.deepEqual(parseResumeDate('2018'), { year: 2018, month: null });
  assert.deepEqual(parseResumeDate('березень 2021'), { year: 2021, month: 3 });
  assert.deepEqual(parseResumeDate('травня 2022'), { year: 2022, month: 5 });
  assert.deepEqual(parseResumeDate('декабрь 2017'), { year: 2017, month: 12 });
  assert.deepEqual(parseResumeDate('März 2020'), { year: 2020, month: 3 });
  assert.deepEqual(parseResumeDate('październik 2023'), { year: 2023, month: 10 });
});

test('parseResumeDate knows the "still there" words in five languages', () => {
  for (const w of ['Present', 'current', 'now', 'дотепер', 'по теперішній час', 'зараз', 'настоящее время', 'heute', 'obecnie']) {
    assert.equal(parseResumeDate(w), 'present', w);
  }
});

test('parseResumeDate refuses what is not a date', () => {
  assert.equal(parseResumeDate('Senior Engineer'), null);
  assert.equal(parseResumeDate(''), null);
  assert.equal(parseResumeDate(null), null);
  assert.equal(parseResumeDate('1850'), null);
  assert.equal(parseResumeDate('version 2020.1 of the SDK')?.toString(), { year: 2020, month: null }.toString());
});

test('parseRange resolves a bare year to a full year and present to now', () => {
  assert.deepEqual(parseRange('2019', '2020', NOW), { from: { year: 2019, month: 1 }, to: { year: 2020, month: 12 } });
  assert.deepEqual(parseRange('Mar 2024', 'Present', NOW), { from: { year: 2024, month: 3 }, to: { year: 2026, month: 9 } });
  assert.equal(parseRange('2022', '2019', NOW), null, 'an end before the start is not a range');
  assert.equal(parseRange('Present', '2020', NOW), null);
  assert.equal(parseRange(null, '2020', NOW), null);
});

test('yearsCovered merges overlapping roles', () => {
  const a = parseRange('Jan 2018', 'Dec 2019', NOW)!;
  const b = parseRange('Jul 2019', 'Jun 2021', NOW)!;
  assert.equal(yearsCovered([a]), 2);
  assert.equal(yearsCovered([a, b]), 3.5, 'two parallel roles are one span of time');
  assert.equal(yearsCovered([]), 0);
});

test('monthsSinceLatest and formatRange', () => {
  const r = parseRange('2020', 'Mar 2025', NOW)!;
  assert.equal(monthsSinceLatest([r], NOW), 18);
  assert.equal(monthsSinceLatest([], NOW), null);
  assert.equal(formatRange(r, NOW), 'Jan 2020 – Mar 2025', 'a bare start year is January of it');
  assert.equal(formatRange(parseRange('Feb 2024', 'now', NOW)!, NOW), 'Feb 2024 – present');
});
