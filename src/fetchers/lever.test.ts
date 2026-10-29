import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapLeverPosting, parseLeverBoard, type LeverPosting } from './lever';

// Recorded on 2026-10-29: perforce's Senior Accountant (two lists[] blocks,
// a closing section, a salaryRange) and siteground's backend role, whose
// descriptionPlain is empty — its whole posting is in lists[]. Trimmed.
const RECORDED = parseLeverBoard(JSON.parse(readFileSync(join(__dirname, 'fixtures', 'lever-postings.json'), 'utf8')), 'recorded');

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

describe('mapLeverPosting — the whole posting (#658)', () => {
  it('keeps the intro, every lists[] block under its heading, the closing section and the salary range', () => {
    const job = mapLeverPosting(RECORDED[0]!, COMPANY_ID);
    const d = job.description;
    assert.match(d, /^Salary: 82550-99000 USD \(year\)\.\n\nPosition Summary:/);
    assert.match(d, /Responsibilities:\n• Perform normal month-end closing procedures/);
    assert.match(d, /Requirements:\n• 3\+ years of accounting experience/);
    assert.match(d, /Strong knowledge of U\.S\. GAAP/);
    assert.match(d, /Additionally, this position is eligible for benefits/);
    // In the order Lever's own page shows them.
    const at = (s: string) => d.indexOf(s);
    assert.ok(at('Position Summary') < at('Responsibilities:') && at('Responsibilities:') < at('Requirements:') && at('Requirements:') < at('Additionally'));
  });

  it('keeps a posting whose intro is empty — siteground stored nothing at all', () => {
    const job = mapLeverPosting(RECORDED[1]!, COMPANY_ID);
    assert.match(job.description, /^YOUR ROLE:\nWe're hiring a Software Engineer/);
    assert.match(job.description, /OUR EXPECTATIONS:\n• Deep understanding of the HTTP stack/);
    assert.match(job.description, /only shortlisted candidates will be contacted/);
    assert.doesNotMatch(job.description, /Salary:/);
  });

  it('reads no salary off a range of zeros, and the hourly wording as an hour', () => {
    const zero = mapLeverPosting(basePosting({ salaryRange: { min: 0, max: 0, currency: 'TRY', interval: 'per-month-salary' } }), COMPANY_ID);
    assert.doesNotMatch(zero.description, /Salary:/);
    const hourly = mapLeverPosting(basePosting({ salaryRange: { min: 40, max: 55, currency: 'USD', interval: 'per-hour-wage' } }), COMPANY_ID);
    assert.match(hourly.description, /^Salary: 40-55 USD \(hour\)\./);
  });

  it('a malformed lists[] or salaryRange costs that field, never the board', () => {
    const [job] = parseLeverBoard([{ ...basePosting(), lists: 'junk', salaryRange: { min: 'lots' } }], 'odd');
    assert.deepEqual(job?.lists, []);
    assert.equal(job?.salaryRange, null);
    assert.throws(() => parseLeverBoard({ ok: false }, 'odd'), /Lever schema invalid for "odd"/);
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
