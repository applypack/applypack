import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapPinpointFeed } from './pinpoint';

const COMPANY_ID = 19;

const posting = (overrides: Record<string, unknown> = {}) => ({
  id: 483201,
  title: 'Senior Software Engineer',
  url: 'https://youlend.pinpointhq.com/en/postings/b03f1c2a-37e1-4443-97d2-caf51f023ebe',
  description: '<div><!--block-->Build the lending platform.</div>',
  key_responsibilities: '<div>Own services end to end.</div>',
  skills_knowledge_expertise: '<div>Node.js &amp; TypeScript.</div>',
  employment_type_text: 'Permanent',
  workplace_type: 'onsite',
  compensation: '€100,000 - €150,000 / year',
  compensation_minimum: 100000,
  compensation_maximum: 150000,
  location: { id: '66524', city: 'Berlin', name: 'Berlin' },
  ...overrides,
});

describe('mapPinpointFeed', () => {
  it('maps a full posting', () => {
    const [job] = mapPinpointFeed({ data: [posting()] }, COMPANY_ID);
    assert.ok(job);
    assert.equal(job.externalId, '483201');
    assert.equal(job.title, 'Senior Software Engineer');
    assert.match(job.url, /youlend\.pinpointhq\.com/);
    assert.equal(job.location, 'Berlin');
    assert.match(job.description, /^Salary: €100,000 - €150,000 \/ year\./);
    assert.match(job.description, /Type: Permanent\./);
    assert.match(job.description, /Build the lending platform\./);
    assert.match(job.description, /Node\.js & TypeScript\./);
  });

  it('returns [] for an empty board', () => {
    assert.deepEqual(mapPinpointFeed({ data: [] }, COMPANY_ID), []);
  });

  it('returns [] for a non-conforming payload', () => {
    assert.deepEqual(mapPinpointFeed('<html>404</html>', COMPANY_ID), []);
    assert.deepEqual(mapPinpointFeed(null, COMPANY_ID), []);
  });

  it('skips a malformed row, keeps the valid ones', () => {
    const jobs = mapPinpointFeed(
      { data: [{ id: 1 }, posting(), false] },
      COMPANY_ID,
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.externalId, '483201');
  });

  it('prefixes the workplace type', () => {
    const [remote] = mapPinpointFeed(
      { data: [posting({ workplace_type: 'remote', location: null })] },
      COMPANY_ID,
    );
    assert.equal(remote!.location, 'Remote');
    const [hybrid] = mapPinpointFeed(
      { data: [posting({ workplace_type: 'hybrid' })] },
      COMPANY_ID,
    );
    assert.equal(hybrid!.location, 'Hybrid · Berlin');
  });

  it('stamps postedAt with first-seen time (dateless source)', () => {
    const before = Date.now();
    const [job] = mapPinpointFeed({ data: [posting()] }, COMPANY_ID);
    assert.ok(job!.postedAt.getTime() >= before - 1000);
  });
});

describe('mapPinpointFeed — location hints (ADR 0031)', () => {
  it('passes only the arrangement — Pinpoint has no country field', () => {
    // Recorded from the digitalscience board on 2026-09-03: name is a country.
    const [job] = mapPinpointFeed(
      { data: [posting({ workplace_type: 'remote', location: { id: '49050', city: ' ', name: 'Germany', province: ' ' } })] },
      COMPANY_ID,
    );
    assert.equal(job?.location, 'Remote · Germany');
    assert.deepEqual(job?.locationHints, { workplace: 'REMOTE' });
    assert.deepEqual(mapPinpointFeed({ data: [posting()] }, COMPANY_ID)[0]?.locationHints, { workplace: 'ONSITE' });
  });
});
