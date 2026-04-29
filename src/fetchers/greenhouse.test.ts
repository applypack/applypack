import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapGreenhouseJob, type GreenhouseJob } from './greenhouse';

const COMPANY_ID = 42;

const baseJob = (overrides: Partial<GreenhouseJob> = {}): GreenhouseJob => ({
  id: 7658329003,
  title: 'Sr. Software Engineer (PHP)',
  location: { name: 'Remote, US' },
  content: '<p>Join our PHP team.</p>',
  absolute_url: 'https://job-boards.greenhouse.io/higherlogic/jobs/7658329003',
  updated_at: '2026-04-28T12:00:00Z',
  departments: [],
  offices: [],
  ...overrides,
});

describe('mapGreenhouseJob', () => {
  it('uses location.name when present', () => {
    const job = mapGreenhouseJob(baseJob(), COMPANY_ID);
    assert.equal(job.location, 'Remote, US');
  });

  it('falls back to offices[].location when top-level location is missing', () => {
    const job = mapGreenhouseJob(
      baseJob({
        location: null,
        offices: [
          { name: 'NYC', location: 'New York, NY' },
          { name: 'SF', location: 'San Francisco, CA' },
        ],
      }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'New York, NY');
  });

  it('falls back to offices[].name when offices.location is also missing', () => {
    const job = mapGreenhouseJob(
      baseJob({
        location: null,
        offices: [{ name: 'Remote — Worldwide' }],
      }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'Remote — Worldwide');
  });

  it('uses empty string when no location info at all (Claude decides)', () => {
    const job = mapGreenhouseJob(
      baseJob({ location: null, offices: [] }),
      COMPANY_ID,
    );
    assert.equal(job.location, '');
  });

  it('strips HTML from content', () => {
    const job = mapGreenhouseJob(
      baseJob({
        content:
          '<p>We are <strong>hiring</strong> a Senior <em>PHP</em> Developer.</p>\n<p>Stack: Laravel.</p>',
      }),
      COMPANY_ID,
    );
    assert.match(job.description, /We are hiring/);
    assert.match(job.description, /PHP Developer/);
    assert.match(job.description, /Laravel/);
    assert.doesNotMatch(job.description, /<\w+>/);
  });

  it('decodes numeric HTML entities (&#x2F;, &#39;, &amp;)', () => {
    const job = mapGreenhouseJob(
      baseJob({
        content: 'PHP&#x2F;Laravel + JS&#x2F;TS &#39;senior&#39; role &amp; more',
      }),
      COMPANY_ID,
    );
    assert.match(job.description, /PHP\/Laravel/);
    assert.match(job.description, /JS\/TS/);
    assert.match(job.description, /'senior'/);
    assert.match(job.description, /& more/);
  });

  it('handles missing content gracefully', () => {
    const a = mapGreenhouseJob(baseJob({ content: null }), COMPANY_ID);
    assert.equal(a.description, '');
    const b = mapGreenhouseJob(baseJob({ content: undefined }), COMPANY_ID);
    assert.equal(b.description, '');
  });

  it('coerces numeric job id to string for externalId', () => {
    const job = mapGreenhouseJob(baseJob({ id: 7658329003 }), COMPANY_ID);
    assert.equal(job.externalId, '7658329003');
    assert.equal(typeof job.externalId, 'string');
  });

  it('preserves the canonical absolute_url for the apply link', () => {
    const job = mapGreenhouseJob(baseJob(), COMPANY_ID);
    assert.equal(
      job.url,
      'https://job-boards.greenhouse.io/higherlogic/jobs/7658329003',
    );
  });

  it('falls back to "now" when updated_at is unparseable', () => {
    const before = Date.now();
    const job = mapGreenhouseJob(
      baseJob({ updated_at: 'not-a-date' }),
      COMPANY_ID,
    );
    assert.ok(job.postedAt.getTime() >= before);
  });

  it('parses valid ISO timestamp', () => {
    const job = mapGreenhouseJob(
      baseJob({ updated_at: '2026-04-28T12:00:00Z' }),
      COMPANY_ID,
    );
    assert.equal(job.postedAt.toISOString(), '2026-04-28T12:00:00.000Z');
  });

  it('regression: HigherLogic-style "Sr. Software Engineer (PHP)" title is preserved verbatim', () => {
    // The user found this job on LinkedIn at HigherLogic's Greenhouse
    // board. Title contains parentheses and a trailing whitespace
    // pattern that must NOT be stripped — the word "PHP" inside parens
    // is what makes it pass the user's profile filter.
    const job = mapGreenhouseJob(
      baseJob({ title: 'Sr. Software Engineer (PHP) ' }),
      COMPANY_ID,
    );
    assert.equal(job.title, 'Sr. Software Engineer (PHP) ');
  });
});
