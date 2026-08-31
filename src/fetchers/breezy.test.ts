import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapBreezyFeed } from './breezy';

const COMPANY_ID = 13;

const position = (overrides: Record<string, unknown> = {}) => ({
  id: '4f4620daf613',
  friendly_id: '4f4620daf613-backend-engineer',
  name: 'Backend Engineer',
  url: 'https://softwaremill.breezy.hr/p/4f4620daf613-backend-engineer',
  published_date: '2026-08-15T09:30:00.000Z',
  type: { id: 'fullTime', name: 'Full-Time' },
  location: {
    name: 'Warsaw, Poland',
    is_remote: false,
    country: { name: 'Poland', id: 'PL' },
  },
  department: 'Engineering',
  salary: '$90,000 – $120,000 / year',
  description: '<p>Build &amp; run Scala services.</p>',
  ...overrides,
});

describe('mapBreezyFeed', () => {
  it('maps a full position', () => {
    const [job] = mapBreezyFeed([position()], COMPANY_ID);
    assert.ok(job);
    assert.equal(job.companyId, COMPANY_ID);
    assert.equal(job.externalId, '4f4620daf613');
    assert.equal(job.title, 'Backend Engineer');
    assert.equal(
      job.url,
      'https://softwaremill.breezy.hr/p/4f4620daf613-backend-engineer',
    );
    assert.equal(job.location, 'Warsaw, Poland');
    assert.equal(job.postedAt.toISOString(), '2026-08-15T09:30:00.000Z');
    assert.match(job.description, /^Department: Engineering\./);
    assert.match(job.description, /Salary: \$90,000 – \$120,000 \/ year\./);
    assert.match(job.description, /Build & run Scala services\./);
  });

  it('returns [] for an empty board', () => {
    assert.deepEqual(mapBreezyFeed([], COMPANY_ID), []);
  });

  it('returns [] for a non-array payload', () => {
    assert.deepEqual(mapBreezyFeed({ error: 'nope' }, COMPANY_ID), []);
    assert.deepEqual(mapBreezyFeed(null, COMPANY_ID), []);
  });

  it('skips a malformed row, keeps the valid ones', () => {
    const jobs = mapBreezyFeed(
      [{ id: 'x' }, position(), 'garbage'],
      COMPANY_ID,
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.externalId, '4f4620daf613');
  });

  it('prefixes Remote from the location flag', () => {
    const [job] = mapBreezyFeed(
      [
        position({
          location: { name: 'Poland', is_remote: true },
        }),
      ],
      COMPANY_ID,
    );
    assert.equal(job!.location, 'Remote · Poland');
  });

  it('handles a missing description and empty header fields', () => {
    const [job] = mapBreezyFeed(
      [
        position({
          description: undefined,
          department: null,
          salary: null,
          type: null,
        }),
      ],
      COMPANY_ID,
    );
    assert.equal(job!.description, '');
  });
});
