import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackSettings } from './settings';
import { ageCountsFrom, autoPack, autoPackUnwanted, copyPack, utcDayStart } from './trigger';

const NOW = new Date('2026-10-05T14:30:00Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const on = parsePackSettings({ enabled: true });

const ask = (over: Partial<Parameters<typeof autoPack>[0]> = {}) =>
  autoPack({ settings: on, fit: 92, countsFrom: daysAgo(1), now: NOW, queuedToday: 0, ...over });

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
  assert.equal(ask({ countsFrom: daysAgo(7) }), 'queue');
  assert.equal(ask({ countsFrom: daysAgo(7.1) }), 'old');
  assert.equal(ask({ settings: parsePackSettings({ enabled: true, maxAgeDays: 30 }), countsFrom: daysAgo(20) }), 'queue');
});

test('the daily limit stops the sixth, and zero is no limit at all', () => {
  assert.equal(ask({ queuedToday: 4 }), 'queue');
  assert.equal(ask({ queuedToday: 5 }), 'limit');
  assert.equal(ask({ settings: parsePackSettings({ enabled: true, dailyLimit: 0 }), queuedToday: 500 }), 'queue');
});

test('a date nobody gave is no evidence that a posting is recent (#379)', () => {
  // An imported row with no date, a board that publishes none: `postedAt` is the moment it was read.
  const read = { postedAt: NOW, undated: true };
  assert.equal(ageCountsFrom(read, 'IMPORT'), null);
  assert.equal(ask({ countsFrom: null }), 'undated');
  assert.equal(ask({ countsFrom: null, fit: 100 }), 'undated');
  // The same posting with a date its source gave is prepared, and an old one is still old.
  assert.equal(ageCountsFrom({ postedAt: daysAgo(30) }, 'REMOTIVE')?.getTime(), daysAgo(30).getTime());
  assert.equal(ask({ countsFrom: NOW }), 'queue');
  assert.equal(ask({ countsFrom: daysAgo(30) }), 'old');
  // Said before the limit is: an undated posting never took a slot.
  assert.equal(ask({ countsFrom: null, queuedToday: 5 }), 'undated');
  // And after what would have stopped it anyway.
  assert.equal(ask({ countsFrom: null, fit: 60 }), 'low-fit');
  assert.equal(ask({ countsFrom: null, settings: parsePackSettings(null) }), 'off');
});

test('an undated posting on a company\'s own board counts from the board\'s previous read (#459)', () => {
  const hourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
  const undated = { postedAt: NOW, undated: true, previousRead: hourAgo };
  // BambooHR and Pinpoint publish no dates: a role new since the last read went up after it.
  assert.equal(ageCountsFrom(undated, 'BAMBOOHR'), hourAgo);
  assert.equal(ask({ countsFrom: ageCountsFrom(undated, 'PINPOINT') }), 'queue');
  // A board last read longer ago than the window allows tells nothing recent enough.
  assert.equal(ask({ countsFrom: ageCountsFrom({ ...undated, previousRead: daysAgo(8) }, 'RIPPLING') }), 'old');
  // A first read has no read before it.
  assert.equal(ageCountsFrom({ postedAt: NOW, undated: true }, 'BAMBOOHR'), null);
  // An aggregator's window, a feed, a file and a folder of rows can bring an old posting back.
  for (const source of ['REMOTIVE', 'HN_HIRING', 'FEED', 'IMPORT', 'FOLDER']) assert.equal(ageCountsFrom(undated, source), null, source);
  assert.equal(ageCountsFrom(undated, null), null);
  // A date the board gave is read as it is, whenever the board was last read.
  assert.equal(ageCountsFrom({ postedAt: daysAgo(3), previousRead: hourAgo }, 'GREENHOUSE')?.getTime(), daysAgo(3).getTime());
});

test('another source\'s copy of a stored role gets one pack between them, and opens no backlog (#380)', () => {
  const onSince = daysAgo(10);
  const role = (over: Partial<Parameters<typeof copyPack>[0]['role']> = {}) => ({ hasPack: false, firstStoredAt: daysAgo(2), ...over });
  // The role already has a pack — queued, ready, stopped or failed, asked for by hand or not: it is prepared once.
  assert.equal(copyPack({ role: role({ hasPack: true }), onSince }), 'has-pack');
  // The original was stored before packs were switched on: the settings promise such a posting is never prepared on its own.
  assert.equal(copyPack({ role: role({ firstStoredAt: daysAgo(11) }), onSince }), 'before-packs');
  // Stored since, and never given a pack (the day's limit was spent, or it scored lower then): the copy is the role's chance.
  assert.equal(copyPack({ role: role(), onSince }), 'queue');
  assert.equal(copyPack({ role: role({ firstStoredAt: onSince }), onSince }), 'queue');
  // No record of when packs went on: nothing shows the role arrived after it.
  assert.equal(copyPack({ role: role(), onSince: null }), 'before-packs');
  // A pack outranks the date: the question of the backlog never comes up for a role that has one.
  assert.equal(copyPack({ role: role({ hasPack: true, firstStoredAt: daysAgo(40) }), onSince: null }), 'has-pack');
});

test('the day the limit counts is the UTC day', () => {
  assert.equal(utcDayStart(NOW).toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(utcDayStart(new Date('2026-10-05T23:59:59.999Z')).toISOString(), '2026-10-05T00:00:00.000Z');
});

test('a pack the tick queued is asked again when the runner takes it', () => {
  const wanted = { enabled: true, status: 'ALERTED', applied: false, muted: false };
  assert.equal(autoPackUnwanted(wanted), null);
  assert.equal(autoPackUnwanted({ ...wanted, status: 'NEW' }), null);
  assert.equal(autoPackUnwanted({ ...wanted, status: 'SAVED' }), null);
  // Switched off since: the queue may hold a day of them.
  assert.equal(autoPackUnwanted({ ...wanted, enabled: false }), 'off');
  assert.equal(autoPackUnwanted({ ...wanted, status: 'DISMISSED' }), 'dismissed');
  // Applied by any road: marked applied, or put on the applications board.
  assert.equal(autoPackUnwanted({ ...wanted, status: 'APPLIED', applied: true }), 'applied');
  assert.equal(autoPackUnwanted({ ...wanted, applied: true }), 'applied');
  assert.equal(autoPackUnwanted({ ...wanted, muted: true }), 'muted');
});
