import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FilterProfile } from '../filter';
import type { NormalizedJob } from '../types';
import { parsePackSettings } from '../pack/settings';
import { QUIET_ABOVE, defaultImportAlerts, packsUpTo, passingRows, previewCounts } from './preview';

const job = (externalId: string, title: string, location = 'Remote'): NormalizedJob => ({
  companyId: 1,
  externalId,
  title,
  url: `https://rows.example/${externalId}`,
  location,
  description: '',
  postedAt: new Date('2026-10-01T00:00:00Z'),
  employer: null,
});

const php: FilterProfile = {
  stackRequired: ['php'],
  roleTypes: [],
  stackExclude: ['junior'],
  countries: ['DE'],
  regions: [],
  workplace: [],
  onsiteCities: [],
};

test('previewCounts: stored rows are set aside before the filter is asked', () => {
  const jobs = [
    job('1', 'PHP Developer', 'Berlin, Germany'),
    job('2', 'PHP Developer', 'Berlin, Germany'),
    job('3', 'Junior PHP Developer', 'Berlin, Germany'),
    // An arrangement and a country the search does not hunt in: the filter can say no without the model.
    job('4', 'PHP Developer', 'Remote, United States'),
    job('5', 'Gardener', 'Berlin, Germany'),
  ];
  assert.deepEqual(previewCounts(jobs, [php], new Set(['2'])), { usable: 5, stored: 1, turnedAway: 0, passing: 1 });
});

test('previewCounts: any running search admits a row, and no search admits none', () => {
  const jobs = [job('1', 'PHP Developer', 'Berlin, Germany'), job('2', 'Gardener', 'Lisbon, Portugal')];
  const anything: FilterProfile = { ...php, stackRequired: ['gardener'], stackExclude: [], countries: [] };
  assert.equal(previewCounts(jobs, [php, anything], new Set()).passing, 2);
  assert.equal(previewCounts(jobs, [], new Set()).passing, 0);
});

test('previewCounts: a muted company’s rows are counted apart, and only among rows a search admits', () => {
  const jobs = [
    { ...job('1', 'PHP Developer', 'Berlin, Germany'), employer: 'Acme' },
    { ...job('2', 'PHP Developer', 'Berlin, Germany'), employer: 'Other' },
    // Muted and filtered: the filter took it first, as it does in the tick.
    { ...job('3', 'Gardener', 'Berlin, Germany'), employer: 'Acme' },
    // Muted and already stored: stored comes first.
    { ...job('4', 'PHP Developer', 'Berlin, Germany'), employer: 'Acme' },
  ];
  const muted = (j: NormalizedJob): boolean => j.employer === 'Acme';
  assert.deepEqual(previewCounts(jobs, [php], new Set(['4']), muted), { usable: 4, stored: 1, turnedAway: 1, passing: 1 });
});

test('passingRows are the rows previewCounts counts as passing', () => {
  const jobs = [
    { ...job('1', 'PHP Developer', 'Berlin, Germany'), employer: 'Acme' },
    { ...job('2', 'PHP Developer', 'Berlin, Germany'), employer: 'Other' },
    { ...job('3', 'Gardener', 'Berlin, Germany'), employer: 'Other' },
    { ...job('4', 'PHP Developer', 'Berlin, Germany'), employer: 'Other' },
  ];
  const muted = (j: NormalizedJob): boolean => j.employer === 'Acme';
  const rows = passingRows(jobs, [php], new Set(['4']), muted);
  assert.deepEqual(rows.map((r) => r.externalId), ['2']);
  assert.equal(rows.length, previewCounts(jobs, [php], new Set(['4']), muted).passing);
});

test('a large import is offered with no alerts, a small one with them (#402)', () => {
  assert.equal(defaultImportAlerts(0), 'matches');
  assert.equal(defaultImportAlerts(QUIET_ABOVE), 'matches');
  assert.equal(defaultImportAlerts(QUIET_ABOVE + 1), 'off');
  assert.equal(defaultImportAlerts(2000), 'off');
});

test('packsUpTo: the rows the pack trigger would take, under what is left of the day (#402)', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const daysAgo = (n: number): Date => new Date(now.getTime() - n * 86_400_000);
  const dated = (id: string, days: number): NormalizedJob => ({ ...job(id, 'PHP Developer'), postedAt: daysAgo(days) });
  const rows = [dated('1', 1), dated('2', 3), dated('3', 6), dated('4', 30), { ...dated('5', 0), undated: true }];
  const on = (over: Record<string, unknown> = {}) => parsePackSettings({ enabled: true, dailyLimit: 0, maxAgeDays: 7, ...over });
  // Off: none, whatever the rows say.
  assert.equal(packsUpTo(rows, parsePackSettings(null), 0, now), 0);
  // On with no limit: the three with a recent date of their own — not the month-old one, not the one the file gave no date.
  assert.equal(packsUpTo(rows, on(), 0, now), 3);
  // The day's limit, less what the worker already queued today.
  assert.equal(packsUpTo(rows, on({ dailyLimit: 2 }), 0, now), 2);
  assert.equal(packsUpTo(rows, on({ dailyLimit: 5 }), 4, now), 1);
  assert.equal(packsUpTo(rows, on({ dailyLimit: 5 }), 9, now), 0);
  assert.equal(packsUpTo([], on(), 0, now), 0);
});

test('previewCounts: a structured country hint is read like the tick reads it', () => {
  const hinted: NormalizedJob = { ...job('1', 'PHP Developer', 'Remote'), locationHints: { countries: ['DE'] } };
  assert.equal(previewCounts([hinted], [php], new Set()).passing, 1);
  assert.equal(previewCounts([{ ...hinted, locationHints: { countries: ['US'] } }], [php], new Set()).passing, 0);
});
