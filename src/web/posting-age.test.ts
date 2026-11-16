import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OLD_POSTING_DAYS, oldPostingDays } from './posting-age';

const now = new Date('2026-11-15T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

test('an old posting says its age; a recent or undated one says nothing (#770)', () => {
  assert.equal(oldPostingDays({ postedAt: new Date('2026-06-11T07:42:00Z'), postedAtKnown: true }, now), 157);
  assert.equal(oldPostingDays({ postedAt: daysAgo(OLD_POSTING_DAYS), postedAtKnown: true }, now), OLD_POSTING_DAYS);
  assert.equal(oldPostingDays({ postedAt: daysAgo(OLD_POSTING_DAYS - 1), postedAtKnown: true }, now), null);
  assert.equal(oldPostingDays({ postedAt: daysAgo(200), postedAtKnown: false }, now), null, 'first seen is not the posting\'s date');
});
