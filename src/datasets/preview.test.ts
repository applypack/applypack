import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FilterProfile } from '../filter';
import type { NormalizedJob } from '../types';
import { previewCounts } from './preview';

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
  assert.deepEqual(previewCounts(jobs, [php], new Set(['2'])), { usable: 5, stored: 1, passing: 1 });
});

test('previewCounts: any running search admits a row, and no search admits none', () => {
  const jobs = [job('1', 'PHP Developer', 'Berlin, Germany'), job('2', 'Gardener', 'Lisbon, Portugal')];
  const anything: FilterProfile = { ...php, stackRequired: ['gardener'], stackExclude: [], countries: [] };
  assert.equal(previewCounts(jobs, [php, anything], new Set()).passing, 2);
  assert.equal(previewCounts(jobs, [], new Set()).passing, 0);
});

test('previewCounts: a structured country hint is read like the tick reads it', () => {
  const hinted: NormalizedJob = { ...job('1', 'PHP Developer', 'Remote'), locationHints: { countries: ['DE'] } };
  assert.equal(previewCounts([hinted], [php], new Set()).passing, 1);
  assert.equal(previewCounts([{ ...hinted, locationHints: { countries: ['US'] } }], [php], new Set()).passing, 0);
});
