import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapRecruiteeFeed, parseRecruiteeDate } from './recruitee';

const COMPANY_ID = 11;
const SLUG = 'channable';

const offer = (overrides: Record<string, unknown> = {}) => ({
  id: 2723126,
  title: 'Technical Customer Support Benelux',
  slug: 'technical-customer-support-benelux-1',
  status: 'published',
  careers_url: 'https://jobs.channable.com/o/technical-customer-support-benelux-1',
  published_at: '2026-08-28 11:47:47 UTC',
  created_at: '2026-08-26 13:27:15 UTC',
  location: 'Utrecht, Utrecht, Netherlands',
  remote: false,
  hybrid: true,
  description: '<p>Help customers &amp; solve problems.</p>',
  requirements: '<p>Fluent Dutch.</p>',
  salary: { min: '2850', max: '2950', currency: 'EUR', period: 'month' },
  ...overrides,
});

describe('mapRecruiteeFeed', () => {
  it('maps a full offer', () => {
    const [job] = mapRecruiteeFeed({ offers: [offer()] }, COMPANY_ID, SLUG);
    assert.ok(job);
    assert.equal(job.companyId, COMPANY_ID);
    assert.equal(job.externalId, '2723126');
    assert.equal(job.title, 'Technical Customer Support Benelux');
    assert.equal(
      job.url,
      'https://jobs.channable.com/o/technical-customer-support-benelux-1',
    );
    assert.equal(job.location, 'Hybrid · Utrecht, Utrecht, Netherlands');
    assert.equal(job.postedAt.toISOString(), '2026-08-28T11:47:47.000Z');
    assert.match(job.description, /^Salary: 2850-2950 EUR \(month\)\./);
    assert.match(job.description, /Help customers & solve problems\./);
    assert.match(job.description, /Fluent Dutch\./);
  });

  it('returns [] for an empty board', () => {
    assert.deepEqual(mapRecruiteeFeed({ offers: [] }, COMPANY_ID, SLUG), []);
  });

  it('returns [] for a non-conforming payload', () => {
    assert.deepEqual(mapRecruiteeFeed({ error: 'Not Found' }, COMPANY_ID, SLUG), []);
    assert.deepEqual(mapRecruiteeFeed(null, COMPANY_ID, SLUG), []);
  });

  it('skips a malformed row, keeps the valid ones', () => {
    const jobs = mapRecruiteeFeed(
      { offers: [{ id: 1 }, offer(), 42] },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.externalId, '2723126');
  });

  it('skips non-published offers', () => {
    const jobs = mapRecruiteeFeed(
      { offers: [offer({ status: 'draft' })] },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(jobs.length, 0);
  });

  it('prefixes Remote and builds a fallback URL from the offer slug', () => {
    const [job] = mapRecruiteeFeed(
      {
        offers: [
          offer({
            careers_url: null,
            remote: true,
            hybrid: false,
            location: 'Netherlands',
          }),
        ],
      },
      COMPANY_ID,
      SLUG,
    );
    assert.equal(job!.location, 'Remote · Netherlands');
    assert.equal(
      job!.url,
      'https://channable.recruitee.com/o/technical-customer-support-benelux-1',
    );
  });

  it('omits the salary line when the salary object is empty', () => {
    const [job] = mapRecruiteeFeed(
      { offers: [offer({ salary: { min: null, max: null } })] },
      COMPANY_ID,
      SLUG,
    );
    assert.doesNotMatch(job!.description, /Salary:/);
  });
});

describe('parseRecruiteeDate', () => {
  it('parses the "YYYY-MM-DD HH:MM:SS UTC" format', () => {
    assert.equal(
      parseRecruiteeDate('2026-08-26 13:27:15 UTC').toISOString(),
      '2026-08-26T13:27:15.000Z',
    );
  });

  it('falls back to now for garbage', () => {
    const before = Date.now();
    const d = parseRecruiteeDate('not a date');
    assert.ok(d.getTime() >= before - 1000);
  });
});
