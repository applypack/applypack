import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapWorkableFeed } from './workable';

const COMPANY_ID = 13;
const SLUG = 'acme';

describe('mapWorkableFeed', () => {
  it('returns [] for non-object input', () => {
    assert.deepEqual(mapWorkableFeed(null, COMPANY_ID, SLUG), []);
    assert.deepEqual(mapWorkableFeed('not json', COMPANY_ID, SLUG), []);
    assert.deepEqual(mapWorkableFeed(42, COMPANY_ID, SLUG), []);
  });

  it('returns [] when results is missing', () => {
    assert.deepEqual(mapWorkableFeed({}, COMPANY_ID, SLUG), []);
  });

  it('maps a minimal job entry', () => {
    const out = mapWorkableFeed(
      {
        total: 1,
        results: [
          {
            id: 1,
            shortcode: 'ABC123',
            title: 'Senior Backend Engineer',
            remote: true,
            published: '2026-04-28T00:00:00Z',
          },
        ],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(out.length, 1);
    const job = out[0]!;
    assert.equal(job.companyId, COMPANY_ID);
    assert.equal(job.externalId, 'ABC123');
    assert.equal(job.title, 'Senior Backend Engineer');
    assert.equal(job.url, 'https://apply.workable.com/acme/j/ABC123/');
    assert.equal(job.location, 'Remote');
    assert.equal(job.description, '');
  });

  it('coerces numeric id to string', () => {
    const out = mapWorkableFeed(
      {
        results: [{ id: 12345, shortcode: 'X', title: 'Y', published: '' }],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(out[0]?.externalId, 'X');
  });

  it('formats location with city/region/country', () => {
    const out = mapWorkableFeed(
      {
        results: [
          {
            id: '1',
            shortcode: 'X',
            title: 'Engineer',
            location: {
              city: 'Austin',
              region: 'TX',
              country: 'United States',
            },
            published: '',
          },
        ],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(out[0]?.location, 'Austin, TX, United States');
  });

  it('combines Remote + city when remote is true and location given', () => {
    const out = mapWorkableFeed(
      {
        results: [
          {
            id: '1',
            shortcode: 'X',
            title: 'Engineer',
            remote: true,
            location: { city: 'Berlin', country: 'Germany' },
            published: '',
          },
        ],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(out[0]?.location, 'Remote · Berlin, Germany');
  });

  it('treats workplace="remote" as remote', () => {
    const out = mapWorkableFeed(
      {
        results: [
          {
            id: '1',
            shortcode: 'X',
            title: 'Engineer',
            workplace: 'remote',
            published: '',
          },
        ],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(out[0]?.location, 'Remote');
  });

  it('returns "" location when nothing is set (Claude decides)', () => {
    const out = mapWorkableFeed(
      {
        results: [
          { id: '1', shortcode: 'X', title: 'Engineer', published: '' },
        ],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(out[0]?.location, '');
  });

  it('skips malformed entries silently', () => {
    const out = mapWorkableFeed(
      {
        results: [
          { id: '1', shortcode: 'A', title: 'Good', published: '' },
          { not: 'a job' },
          { id: '2', shortcode: 'B', title: 'Also good', published: '' },
        ],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((j) => j.externalId),
      ['A', 'B'],
    );
  });

  it('parses published timestamp', () => {
    const out = mapWorkableFeed(
      {
        results: [
          {
            id: '1',
            shortcode: 'X',
            title: 'Engineer',
            published: '2026-04-28T12:00:00Z',
          },
        ],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(out[0]?.postedAt.toISOString(), '2026-04-28T12:00:00.000Z');
  });

  it('falls back to "now" for unparseable published', () => {
    const before = Date.now();
    const out = mapWorkableFeed(
      {
        results: [
          { id: '1', shortcode: 'X', title: 'Engineer', published: 'bad' },
        ],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.ok((out[0]?.postedAt.getTime() ?? 0) >= before);
  });
});
