import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapBambooFeed } from './bamboohr';

const COMPANY_ID = 17;
const SLUG = 'canopy';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: '42',
  jobOpeningName: 'Senior Backend Engineer',
  departmentLabel: 'Engineering',
  employmentStatusLabel: 'Full-Time',
  employmentType: null,
  location: { city: 'Salt Lake City', state: 'Utah' },
  atsLocation: { country: null, state: null, province: null, city: null },
  isRemote: null,
  locationType: '2',
  ...overrides,
});

describe('mapBambooFeed', () => {
  it('maps a list row and builds the careers URL', () => {
    const [job] = mapBambooFeed(
      { meta: { totalCount: 1 }, result: [row()] },
      COMPANY_ID,
      SLUG,
    );
    assert.ok(job);
    assert.equal(job.externalId, '42');
    assert.equal(job.title, 'Senior Backend Engineer');
    assert.equal(job.url, 'https://canopy.bamboohr.com/careers/42');
    assert.equal(job.location, 'Salt Lake City, Utah');
    assert.equal(job.description, 'Department: Engineering. Type: Full-Time.');
  });

  it('returns [] for an empty board', () => {
    assert.deepEqual(
      mapBambooFeed({ meta: { totalCount: 0 }, result: [] }, COMPANY_ID, SLUG),
      [],
    );
  });

  it('returns [] for a non-conforming payload (marketing-page HTML case)', () => {
    assert.deepEqual(mapBambooFeed('<!doctype html>', COMPANY_ID, SLUG), []);
    assert.deepEqual(mapBambooFeed(null, COMPANY_ID, SLUG), []);
  });

  it('skips a malformed row, keeps the valid ones', () => {
    const jobs = mapBambooFeed(
      { result: [{ id: 1 }, row(), null] },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.externalId, '42');
  });

  it('marks remote rows', () => {
    const [job] = mapBambooFeed(
      { result: [row({ isRemote: true, location: null })] },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(job!.location, 'Remote');
  });

  it('stamps postedAt with first-seen time (dateless source)', () => {
    const before = Date.now();
    const [job] = mapBambooFeed({ result: [row()] }, COMPANY_ID, SLUG);
    assert.ok(job!.postedAt.getTime() >= before - 1000);
  });
});

describe('mapBambooFeed — location hints (ADR 0031)', () => {
  it('passes only the arrangement — the list has no country', () => {
    const [office] = mapBambooFeed({ result: [row()] }, COMPANY_ID, SLUG);
    assert.deepEqual(office?.locationHints, { workplace: 'UNKNOWN' });
    const [remote] = mapBambooFeed({ result: [row({ isRemote: true })] }, COMPANY_ID, SLUG);
    assert.deepEqual(remote?.locationHints, { workplace: 'REMOTE' });
  });
});
