import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapAshbyJob, type AshbyJob } from './ashby';

const COMPANY_ID = 7;

const baseJob = (overrides: Partial<AshbyJob> = {}): AshbyJob => ({
  id: 'ashby-uuid-abc',
  title: 'Senior Backend Engineer',
  department: 'Engineering',
  team: 'Platform',
  employmentType: 'FullTime',
  location: 'New York',
  secondaryLocations: [],
  publishedAt: '2026-04-28T12:00:00Z',
  isListed: true,
  isRemote: false,
  workplaceType: 'Hybrid',
  jobUrl: 'https://jobs.ashbyhq.com/buffer/ashby-uuid-abc',
  applyUrl: 'https://jobs.ashbyhq.com/buffer/ashby-uuid-abc/application',
  descriptionHtml: '<p>Senior Node.js role.</p>',
  ...overrides,
});

describe('mapAshbyJob', () => {
  it('joins primary + secondary locations with " / "', () => {
    const job = mapAshbyJob(
      baseJob({
        location: 'New York',
        secondaryLocations: [
          { location: 'San Francisco' },
          { location: 'Remote — US' },
        ],
      }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'New York / San Francisco / Remote — US (Hybrid)');
  });

  it('appends workplaceType in parens', () => {
    const job = mapAshbyJob(
      baseJob({ workplaceType: 'Remote', location: 'Anywhere' }),
      COMPANY_ID,
    );
    assert.match(job.location, /\(Remote\)$/);
  });

  it('omits workplace suffix when workplaceType is null', () => {
    const job = mapAshbyJob(
      baseJob({ workplaceType: null, location: 'Boston' }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'Boston');
  });

  it('skips empty / null secondary locations', () => {
    const job = mapAshbyJob(
      baseJob({
        location: 'NYC',
        secondaryLocations: [
          { location: null },
          { location: '' },
          { location: 'Boston' },
        ],
      }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'NYC / Boston (Hybrid)');
  });

  it('returns empty location when both primary and secondary are missing', () => {
    const job = mapAshbyJob(
      baseJob({
        location: null,
        secondaryLocations: [],
        workplaceType: null,
      }),
      COMPANY_ID,
    );
    assert.equal(job.location, '');
  });

  it('preserves Ashby uuid as externalId', () => {
    const job = mapAshbyJob(baseJob(), COMPANY_ID);
    assert.equal(job.externalId, 'ashby-uuid-abc');
  });

  it('strips HTML from descriptionHtml', () => {
    const job = mapAshbyJob(
      baseJob({
        descriptionHtml:
          '<h2>About the role</h2><p>Senior <em>PHP</em> engineer.</p>',
      }),
      COMPANY_ID,
    );
    assert.match(job.description, /About the role/);
    assert.match(job.description, /Senior PHP engineer/);
    assert.doesNotMatch(job.description, /<\w+>/);
  });

  it('handles missing descriptionHtml', () => {
    const a = mapAshbyJob(
      baseJob({ descriptionHtml: null }),
      COMPANY_ID,
    );
    assert.equal(a.description, '');
  });

  it('parses ISO publishedAt', () => {
    const job = mapAshbyJob(
      baseJob({ publishedAt: '2026-04-28T12:00:00Z' }),
      COMPANY_ID,
    );
    assert.equal(job.postedAt.toISOString(), '2026-04-28T12:00:00.000Z');
  });

  it('falls back to "now" when publishedAt is unparseable', () => {
    const before = Date.now();
    const job = mapAshbyJob(
      baseJob({ publishedAt: 'totally not a date' }),
      COMPANY_ID,
    );
    assert.ok(job.postedAt.getTime() >= before);
  });

  it('uses jobUrl (canonical) for url, not applyUrl', () => {
    const job = mapAshbyJob(baseJob(), COMPANY_ID);
    assert.equal(job.url, 'https://jobs.ashbyhq.com/buffer/ashby-uuid-abc');
  });
});
