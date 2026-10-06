import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackSettings } from './settings';
import { autoPack, utcDayStart } from './trigger';

const NOW = new Date('2026-10-05T14:30:00Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const on = parsePackSettings({ enabled: true });

const ask = (over: Partial<Parameters<typeof autoPack>[0]> = {}) =>
  autoPack({ settings: on, fit: 92, postedAt: daysAgo(1), now: NOW, queuedToday: 0, ...over });

test('switched off, nothing is ever queued — the state of every fresh install', () => {
  assert.equal(ask({ settings: parsePackSettings(null), fit: 100 }), 'off');
});

test('a new posting at or above the fit the person set is queued', () => {
  assert.equal(ask(), 'queue');
  assert.equal(ask({ fit: 90 }), 'queue');
  assert.equal(ask({ fit: 89 }), 'low-fit');
  assert.equal(ask({ fit: null }), 'low-fit');
  assert.equal(ask({ settings: parsePackSettings({ enabled: true, minFit: 95 }), fit: 92 }), 'low-fit');
});

test('a posting that has been up longer than the person allows is not prepared on its own', () => {
  assert.equal(ask({ postedAt: daysAgo(7) }), 'queue');
  assert.equal(ask({ postedAt: daysAgo(7.1) }), 'old');
  assert.equal(ask({ settings: parsePackSettings({ enabled: true, maxAgeDays: 30 }), postedAt: daysAgo(20) }), 'queue');
});

test('the daily limit stops the sixth, and zero is no limit at all', () => {
  assert.equal(ask({ queuedToday: 4 }), 'queue');
  assert.equal(ask({ queuedToday: 5 }), 'limit');
  assert.equal(ask({ settings: parsePackSettings({ enabled: true, dailyLimit: 0 }), queuedToday: 500 }), 'queue');
});

test('the day the limit counts is the UTC day', () => {
  assert.equal(utcDayStart(NOW).toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(utcDayStart(new Date('2026-10-05T23:59:59.999Z')).toISOString(), '2026-10-05T00:00:00.000Z');
});
