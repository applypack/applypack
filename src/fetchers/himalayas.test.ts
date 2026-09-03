import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapHimalayasFeed } from './himalayas';
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
