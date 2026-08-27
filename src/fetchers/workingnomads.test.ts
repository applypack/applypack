import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapWorkingNomadsFeed } from './workingnomads';
import type { NormalizedJob } from '../types';

const COMPANY_ID = 77;

// Verbatim shape from https://www.workingnomads.com/api/exposed_jobs/
// (captured 2026-08-27).
const SAMPLE_JOB = {
  url: 'https://www.workingnomads.com/job/go/1818986/',
  title: 'Senior Embedded Software Engineer',
  description:
    'Are you a talented Senior Embedded Software Engineer looking for a remote job? Look no further than Lemon.io.',
  company_name: 'Lemon.io',
  category_name: 'Development',
  tags: 'embedded software engineer,cplusplus,linux,javascript,english',
  location: 'Europe, North America, Latin America, APAC',
  pub_date: '2026-08-27T05:42:51-04:00',
};

function first(jobs: NormalizedJob[]): NormalizedJob {
  const job = jobs[0];
  assert.ok(job, 'expected at least one mapped job');
  return job;
}

describe('mapWorkingNomadsFeed', () => {
  it('maps a realistic job and extracts the numeric posting id', () => {
    const job = first(mapWorkingNomadsFeed([SAMPLE_JOB], COMPANY_ID));
    assert.equal(job.externalId, '1818986');
    assert.equal(job.title, 'Senior Embedded Software Engineer');
    assert.equal(job.url, 'https://www.workingnomads.com/job/go/1818986/');
    assert.equal(job.companyId, COMPANY_ID);
  });

  it('prefixes non-remote location text with "Remote ·"', () => {
    const job = first(mapWorkingNomadsFeed([SAMPLE_JOB], COMPANY_ID));
    assert.equal(job.location, 'Remote · Europe, North America, Latin America, APAC');
  });

  it('defaults location to "Remote" when missing, null, or blank', () => {
    for (const location of [undefined, null, '   ']) {
      const job = first(
        mapWorkingNomadsFeed([{ ...SAMPLE_JOB, location }], COMPANY_ID),
      );
      assert.equal(job.location, 'Remote');
    }
  });

  it('keeps location verbatim when it already says remote', () => {
    const job = first(
      mapWorkingNomadsFeed(
        [{ ...SAMPLE_JOB, location: 'Remote, USA only' }],
        COMPANY_ID,
      ),
    );
    assert.equal(job.location, 'Remote, USA only');
  });

  it('folds employer, category, and tags into the description', () => {
    const job = first(mapWorkingNomadsFeed([SAMPLE_JOB], COMPANY_ID));
    assert.match(job.description, /Hiring company: Lemon\.io\./);
    assert.match(job.description, /Category: Development\./);
    assert.match(job.description, /Tags: embedded software engineer,cplusplus/);
    assert.match(job.description, /Look no further than Lemon\.io/);
  });

  it('parses ISO pub_date with timezone offset', () => {
    const job = first(mapWorkingNomadsFeed([SAMPLE_JOB], COMPANY_ID));
    assert.equal(job.postedAt.toISOString(), '2026-08-27T09:42:51.000Z');
  });

  it('falls back to now for a malformed pub_date', () => {
    const before = Date.now();
    const job = first(
      mapWorkingNomadsFeed([{ ...SAMPLE_JOB, pub_date: 'not-a-date' }], COMPANY_ID),
    );
    assert.ok(job.postedAt.getTime() >= before);
  });

  it('synthesises a hash externalId when the url shape is unexpected', () => {
    const job = first(
      mapWorkingNomadsFeed(
        [{ ...SAMPLE_JOB, url: 'https://www.workingnomads.com/jobs' }],
        COMPANY_ID,
      ),
    );
    assert.match(job.externalId, /^[0-9a-f]{16}$/);
  });

  it('skips malformed items but keeps valid ones', () => {
    const jobs = mapWorkingNomadsFeed(
      [
        SAMPLE_JOB,
        { nonsense: true },
        { ...SAMPLE_JOB, url: 'https://www.workingnomads.com/job/go/2/' },
      ],
      COMPANY_ID,
    );
    assert.equal(jobs.length, 2);
    assert.deepEqual(
      jobs.map((j) => j.externalId),
      ['1818986', '2'],
    );
  });

  it('returns [] when the response is not an array', () => {
    assert.deepEqual(mapWorkingNomadsFeed({ jobs: [SAMPLE_JOB] }, COMPANY_ID), []);
    assert.deepEqual(mapWorkingNomadsFeed(null, COMPANY_ID), []);
  });
});
