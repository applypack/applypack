import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapHnJobHit, type HnJobHit } from './hn-jobs';

const COMPANY_ID = 11;

const baseHit = (overrides: Partial<HnJobHit> = {}): HnJobHit => ({
  objectID: '40000000',
  title: 'Acme Is Hiring a Founding Engineer (SF or Remote)',
  url: 'https://acme.example.com/careers',
  job_text: '<p>Help us build the future.</p>',
  story_text: null,
  created_at: '2026-04-29T12:00:00Z',
  created_at_i: 1745928000,
  ...overrides,
});

describe('mapHnJobHit', () => {
  it('uses objectID with hn-job- prefix as externalId', () => {
    const job = mapHnJobHit(baseHit({ objectID: '12345' }), COMPANY_ID);
    assert.equal(job.externalId, 'hn-job-12345');
  });

  it('preserves the company-supplied URL verbatim', () => {
    const job = mapHnJobHit(
      baseHit({
        url: 'https://jobs.ashbyhq.com/infisical/782b9da8-20e1-48b2-919e-6c5430c58628',
      }),
      COMPANY_ID,
    );
    assert.equal(
      job.url,
      'https://jobs.ashbyhq.com/infisical/782b9da8-20e1-48b2-919e-6c5430c58628',
    );
  });

  it('falls back to news.ycombinator.com URL when hit.url is null', () => {
    const job = mapHnJobHit(
      baseHit({ objectID: '12345', url: null }),
      COMPANY_ID,
    );
    assert.equal(job.url, 'https://news.ycombinator.com/item?id=12345');
  });

  it('extracts trailing parens as location', () => {
    const job = mapHnJobHit(
      baseHit({ title: 'Acme Is Hiring (Remote US)' }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'Remote US');
  });

  it('skips YC batch markers when extracting location', () => {
    const job = mapHnJobHit(
      baseHit({
        title: 'Infisical (YC W23) Is Hiring Full Stack Software Engineers (Remote)',
      }),
      COMPANY_ID,
    );
    assert.equal(job.location, 'Remote');
  });

  it('returns "" location when title has no parens', () => {
    const job = mapHnJobHit(
      baseHit({ title: 'Stardex Is Hiring a Founding Engineer' }),
      COMPANY_ID,
    );
    assert.equal(job.location, '');
  });

  it('returns "" location when only YC batch is present', () => {
    const job = mapHnJobHit(
      baseHit({ title: 'Acme (YC S22) Is Hiring' }),
      COMPANY_ID,
    );
    assert.equal(job.location, '');
  });

  it('strips HTML entities from job_text', () => {
    const job = mapHnJobHit(
      baseHit({
        job_text: '<p>We&#x27;re hiring &amp; growing fast.</p>',
      }),
      COMPANY_ID,
    );
    assert.match(job.description, /We're hiring & growing fast/);
    assert.doesNotMatch(job.description, /<\w+>/);
  });

  it('falls back to story_text when job_text is missing', () => {
    const job = mapHnJobHit(
      baseHit({ job_text: null, story_text: 'Story body content here.' }),
      COMPANY_ID,
    );
    assert.equal(job.description, 'Story body content here.');
  });

  it('handles empty title gracefully', () => {
    const job = mapHnJobHit(baseHit({ title: '' }), COMPANY_ID);
    assert.equal(job.title, 'Untitled HN job');
  });

  it('parses created_at_i as epoch seconds', () => {
    const job = mapHnJobHit(
      baseHit({ created_at_i: 1745928000, created_at: null }),
      COMPANY_ID,
    );
    assert.equal(job.postedAt.toISOString(), '2025-04-29T12:00:00.000Z');
  });

  it('falls back to ISO created_at when created_at_i is missing', () => {
    const job = mapHnJobHit(
      baseHit({ created_at_i: null, created_at: '2026-04-29T12:00:00Z' }),
      COMPANY_ID,
    );
    assert.equal(job.postedAt.toISOString(), '2026-04-29T12:00:00.000Z');
  });

  it('regression: Infisical YC W23 job preserves Ashby URL for discovery', () => {
    // Real example pulled from HN /jobs Algolia API. The URL is exactly
    // the kind of thing extractAtsToken should pick up: a Greenhouse /
    // Lever / Ashby ATS link → CompanyCandidate. We just need the URL
    // here to flow through verbatim.
    const job = mapHnJobHit(
      baseHit({
        objectID: '40892341',
        title: 'Infisical (YC W23) Is Hiring Full Stack Software Engineers (Remote)',
        url: 'https://jobs.ashbyhq.com/infisical/782b9da8-20e1-48b2-919e-6c5430c58628',
      }),
      COMPANY_ID,
    );
    assert.equal(
      job.url,
      'https://jobs.ashbyhq.com/infisical/782b9da8-20e1-48b2-919e-6c5430c58628',
    );
    assert.match(job.title, /Infisical/);
    assert.equal(job.location, 'Remote');
  });
});
