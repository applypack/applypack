import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { himalayasUrls, mapHimalayasFeed, nextPageUrl, walkBrowseFeed } from './himalayas';
import type { NormalizedJob } from '../types';

const COMPANY_ID = 88;

// Verbatim shape from https://himalayas.app/jobs/api?limit=1
// (captured 2026-08-27). pubDate is epoch SECONDS.
const SAMPLE_JOB = {
  title: 'Senior Full Stack Engineer',
  companyName: 'Venon Solutions',
  companySlug: 'venon-solutions',
  companyLogo: '',
  employmentType: 'Full Time',
  minSalary: null,
  maxSalary: null,
  salaryPeriod: 'annual',
  seniority: ['Mid-level', 'Senior'],
  currency: null,
  locationRestrictions: ['United States'],
  timezoneRestrictions: [-10, -9, -8, -7, -6, -5, 14],
  categories: ['Software-Engineering'],
  parentCategories: ['Engineering'],
  pubDate: 1787776402,
  expiryDate: 1790313150,
  applicationLink:
    'https://himalayas.app/companies/venon-solutions/jobs/senior-full-stack-engineer',
  guid: 'https://himalayas.app/companies/venon-solutions/jobs/senior-full-stack-engineer',
  excerpt: 'Short excerpt.',
  description: '<h3>Role</h3><p>Build things with PHP &amp; Laravel.</p>',
};

function wrap(jobs: unknown[]) {
  return {
    comments: 'api changelog notes',
    updatedAt: 1787845813,
    offset: 0,
    limit: 20,
    totalCount: 96433,
    nextCursor: 'abc',
    jobs,
  };
}

function first(jobs: NormalizedJob[]): NormalizedJob {
  const job = jobs[0];
  assert.ok(job, 'expected at least one mapped job');
  return job;
}

describe('mapHimalayasFeed', () => {
  it('maps a realistic job with guid as externalId', () => {
    const job = first(mapHimalayasFeed(wrap([SAMPLE_JOB]), COMPANY_ID));
    assert.equal(job.externalId, SAMPLE_JOB.guid);
    assert.equal(job.url, SAMPLE_JOB.applicationLink);
    assert.equal(job.title, 'Senior Full Stack Engineer');
    assert.equal(job.companyId, COMPANY_ID);
  });

  it('converts epoch-seconds pubDate and guards a future ms switch', () => {
    const seconds = first(mapHimalayasFeed(wrap([SAMPLE_JOB]), COMPANY_ID));
    assert.equal(seconds.postedAt.getTime(), 1787776402000);
    const millis = first(
      mapHimalayasFeed(wrap([{ ...SAMPLE_JOB, pubDate: 1787776402000 }]), COMPANY_ID),
    );
    assert.equal(millis.postedAt.getTime(), 1787776402000);
  });

  it('joins locationRestrictions under a Remote prefix', () => {
    const job = first(mapHimalayasFeed(wrap([SAMPLE_JOB]), COMPANY_ID));
    assert.equal(job.location, 'Remote · United States');
    const worldwide = first(
      mapHimalayasFeed(wrap([{ ...SAMPLE_JOB, locationRestrictions: [] }]), COMPANY_ID),
    );
    assert.equal(worldwide.location, 'Remote');
  });

  it('strips HTML and folds employer / type / seniority into description', () => {
    const job = first(mapHimalayasFeed(wrap([SAMPLE_JOB]), COMPANY_ID));
    assert.match(job.description, /Hiring company: Venon Solutions\./);
    assert.match(job.description, /Type: full time\./);
    assert.match(job.description, /Seniority: Mid-level, Senior\./);
    assert.match(job.description, /Build things with PHP & Laravel\./);
    assert.doesNotMatch(job.description, /<h3>|<p>/);
  });

  it('folds a structured salary range into the description', () => {
    const job = first(
      mapHimalayasFeed(
        wrap([
          {
            ...SAMPLE_JOB,
            minSalary: 90000,
            maxSalary: 120000,
            currency: 'USD',
            salaryPeriod: 'annual',
          },
        ]),
        COMPANY_ID,
      ),
    );
    assert.match(job.description, /Salary: 90000-120000 USD \(annual\)\./);
    const hourlyMin = first(
      mapHimalayasFeed(
        wrap([{ ...SAMPLE_JOB, minSalary: 50, salaryPeriod: 'hourly' }]),
        COMPANY_ID,
      ),
    );
    assert.match(hourlyMin.description, /Salary: from 50 USD \(hourly\)\./);
  });

  it('omits the salary line when both bounds are null', () => {
    const job = first(mapHimalayasFeed(wrap([SAMPLE_JOB]), COMPANY_ID));
    assert.doesNotMatch(job.description, /Salary:/);
  });

  it('falls back to excerpt when description is empty', () => {
    const job = first(
      mapHimalayasFeed(wrap([{ ...SAMPLE_JOB, description: '' }]), COMPANY_ID),
    );
    assert.match(job.description, /Short excerpt\./);
  });

  it('skips malformed items but keeps valid ones', () => {
    const jobs = mapHimalayasFeed(
      wrap([SAMPLE_JOB, { title: 123 }, { ...SAMPLE_JOB, title: 'Second' }]),
      COMPANY_ID,
    );
    assert.equal(jobs.length, 2);
  });

  it('returns [] when the top-level shape is wrong', () => {
    assert.deepEqual(mapHimalayasFeed([SAMPLE_JOB], COMPANY_ID), []);
    assert.deepEqual(mapHimalayasFeed(null, COMPANY_ID), []);
    assert.deepEqual(mapHimalayasFeed({ notJobs: [] }, COMPANY_ID), []);
  });
});

describe('mapHimalayasFeed — location hints (ADR 0031)', () => {
  it('resolves the ISO names in locationRestrictions to codes', () => {
    const [job] = mapHimalayasFeed({ jobs: [{ ...SAMPLE_JOB, locationRestrictions: ['Germany', 'Netherlands', 'Narnia'] }] }, COMPANY_ID);
    assert.equal(job?.location, 'Remote · Germany, Netherlands, Narnia');
    assert.deepEqual(job?.locationHints, { workplace: 'REMOTE', countries: ['DE', 'NL'] });
  });
});

describe('himalayasUrls — the calls a context needs (stage 3a)', () => {
  it('one search per country plus worldwide when the searches name countries', () => {
    assert.deepEqual(himalayasUrls({ countries: ['PL', 'DE'], regions: [] }), [
      'https://himalayas.app/jobs/api/search?country=PL&exclude_worldwide=true&limit=20',
      'https://himalayas.app/jobs/api/search?country=DE&exclude_worldwide=true&limit=20',
      'https://himalayas.app/jobs/api/search?worldwide=true&limit=20',
    ]);
  });

  it('adds the browse feed when a group is named beside the countries', () => {
    assert.deepEqual(himalayasUrls({ countries: ['PL', 'DE'], regions: ['EU'] }), [
      'https://himalayas.app/jobs/api/search?country=PL&exclude_worldwide=true&limit=20',
      'https://himalayas.app/jobs/api/search?country=DE&exclude_worldwide=true&limit=20',
      'https://himalayas.app/jobs/api/search?worldwide=true&limit=20',
      'https://himalayas.app/jobs/api?limit=20',
    ]);
  });

  it('the browse feed when the searches hunt anywhere or name only groups', () => {
    assert.deepEqual(himalayasUrls({ countries: [], regions: [] }), ['https://himalayas.app/jobs/api?limit=20']);
    assert.deepEqual(himalayasUrls({ countries: [], regions: ['EU'] }), ['https://himalayas.app/jobs/api?limit=20']);
  });

  it('caps the country calls', () => {
    const many = Array.from({ length: 12 }, (_, i) => `C${i}`);
    assert.equal(himalayasUrls({ countries: many, regions: [] }).length, 9);
  });
});

/**
 * #661: one browse page an hour saw 9 % of the new postings — the 100 newest
 * spanned 27 minutes. A read walks the cursor back to the previous read.
 */
describe('walkBrowseFeed — the cursor back to the previous read', () => {
  const HOUR_S = 3600;
  const NOW_S = 1793275110; // 2026-10-29T11:58:30Z
  /** Page `n` (0 = newest): twenty postings over half an hour, then a cursor unless it is the last. */
  const page = (n: number, last = false) => ({
    ...wrap(
      Array.from({ length: 20 }, (_, i) => ({
        ...SAMPLE_JOB,
        guid: `https://himalayas.app/jobs/${n}-${i}`,
        pubDate: NOW_S - n * HOUR_S / 2 - i * 40,
      })),
    ),
    nextCursor: last ? undefined : `cursor-${n + 1}`,
  });
  /** A reader over `count` pages that records the URLs it was asked for. */
  const reader = (count: number, fail?: number) => {
    const asked: string[] = [];
    const read = async (url: string): Promise<unknown> => {
      asked.push(url);
      const n = asked.length - 1;
      if (n === fail) throw new Error('429 Too Many Requests');
      return page(n, n === count - 1);
    };
    return { asked, read };
  };

  it('stops at the page that reaches back past the previous read, less the cache\'s two hours', async () => {
    const { asked, read } = reader(20);
    // The previous read an hour ago: its first page may have been two hours old, so the walk reaches three hours back.
    const jobs = await walkBrowseFeed(read, COMPANY_ID, new Date((NOW_S - HOUR_S) * 1000));
    assert.equal(asked.length, 7);
    assert.equal(jobs.length, 140);
    assert.equal(asked[0], 'https://himalayas.app/jobs/api?limit=20');
    assert.equal(asked[1], 'https://himalayas.app/jobs/api?limit=20&cursor=cursor-1');
  });

  it('reads ten pages at most, and all ten when there was no previous read', async () => {
    const { asked, read } = reader(20);
    assert.equal((await walkBrowseFeed(read, COMPANY_ID, null)).length, 200);
    assert.equal(asked.length, 10);
  });

  it('ends where the feed ends, and with the pages it has when a later one fails', async () => {
    const short = reader(3);
    assert.equal((await walkBrowseFeed(short.read, COMPANY_ID, null)).length, 60);
    assert.equal(short.asked.length, 3);
    const failing = reader(20, 4);
    assert.equal((await walkBrowseFeed(failing.read, COMPANY_ID, null)).length, 80);
    await assert.rejects(walkBrowseFeed(reader(20, 0).read, COMPANY_ID, null), /429/);
  });

  it('builds the next page from nextCursor, and none without one', () => {
    assert.equal(nextPageUrl({ jobs: [], nextCursor: 'MjAy/+=' }), 'https://himalayas.app/jobs/api?limit=20&cursor=MjAy%2F%2B%3D');
    assert.equal(nextPageUrl({ jobs: [] }), null);
    assert.equal(nextPageUrl({ jobs: [], nextCursor: '' }), null);
  });
});
