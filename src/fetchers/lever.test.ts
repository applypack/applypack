import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapLeverPosting, type LeverPosting } from './lever';

const COMPANY_ID = 99;

const basePosting = (overrides: Partial<LeverPosting> = {}): LeverPosting => ({
  id: '5e7f6c91-d3a9-4f8e-bcde-1234567890ab',
  text: 'Senior Software Engineer - Fullstack',
  categories: { location: 'San Francisco', allLocations: [] },
  descriptionPlain: 'Build the next generation of Plaid APIs.',
  hostedUrl: 'https://jobs.lever.co/plaid/abc-def',
  createdAt: 1714305600000, // 2024-04-28
  workplaceType: 'hybrid',
  ...overrides,
});

describe('mapLeverPosting', () => {
  it('uses categories.location when present', () => {
    const job = mapLeverPosting(basePosting(), COMPANY_ID);
    assert.equal(job.location, 'San Francisco (hybrid)');
  });

  it('appends workplaceType in parens', () => {
    const a = mapLeverPosting(
      basePosting({ workplaceType: 'remote' }),
      COMPANY_ID,
    );
    assert.match(a.location, /\(remote\)$/);
    const b = mapLeverPosting(
      basePosting({ workplaceType: 'on-site' }),
      COMPANY_ID,
    );
    assert.match(b.location, /\(on-site\)$/);
  });

  it('omits workplace suffix when workplaceType is null', () => {
    const job = mapLeverPosting(
      basePosting({ workplaceType: null }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'San Francisco');
  });

  it('falls back to categories.allLocations[0] when location is null', () => {
    const job = mapLeverPosting(
      basePosting({
        categories: {
          location: null,
          allLocations: ['Remote — Americas', 'New York, NY'],
        },
        workplaceType: null,
      }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'Remote — Americas');
  });

  it('returns empty location when both fields are missing (Claude decides)', () => {
    const job = mapLeverPosting(
      basePosting({
        categories: { location: null, allLocations: [] },
        workplaceType: null,
      }),
      COMPANY_ID,
    );
    assert.equal(job.location, '');
  });

  it('handles missing categories object entirely', () => {
    const job = mapLeverPosting(
      basePosting({ categories: undefined, workplaceType: null }),
      COMPANY_ID,
    );
    assert.equal(job.location, '');
  });

  it('preserves the Lever uuid as externalId', () => {
    const job = mapLeverPosting(basePosting(), COMPANY_ID);
    assert.equal(job.externalId, '5e7f6c91-d3a9-4f8e-bcde-1234567890ab');
  });

  it('parses createdAt epoch ms', () => {
    const job = mapLeverPosting(
      basePosting({ createdAt: 1714305600000 }),
      COMPANY_ID,
    );
    assert.equal(job.postedAt.toISOString(), '2024-04-28T12:00:00.000Z');
  });

  it('handles null descriptionPlain (Workable-style title-only jobs)', () => {
    const job = mapLeverPosting(
      basePosting({ descriptionPlain: null }),
      COMPANY_ID,
    );
    assert.equal(job.description, '');
  });

  it('leaves descriptionPlain unchanged (no HTML to strip)', () => {
    const job = mapLeverPosting(
      basePosting({
        descriptionPlain: 'Senior PHP role.\n\nStack: Laravel + Vue.',
      }),
      COMPANY_ID,
    );
    assert.match(job.description, /Senior PHP role\./);
    assert.match(job.description, /Laravel \+ Vue/);
  });
});

describe('mapLeverPosting — location hints (ADR 0031)', () => {
  it('passes the ISO country and the arrangement as hints', () => {
    // Recorded from the spotify board on 2026-09-03.
    const job = mapLeverPosting(
      basePosting({ categories: { location: 'London', allLocations: [] }, country: 'GB', workplaceType: 'hybrid' }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'London (hybrid)');
    assert.deepEqual(job.locationHints, { countries: ['GB'], workplace: 'HYBRID' });
    assert.deepEqual(
      mapLeverPosting(basePosting({ country: 'US', workplaceType: 'onsite' }), COMPANY_ID).locationHints,
      { countries: ['US'], workplace: 'ONSITE' },
    );
  });

  it('leaves the hints empty when the board sends neither', () => {
    const job = mapLeverPosting(basePosting({ country: null, workplaceType: null }), COMPANY_ID);
    assert.deepEqual(job.locationHints, { countries: [], workplace: 'UNKNOWN' });
  });
});
