import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapFourDayWeekPage } from './fourdayweek';

const COMPANY_ID = 29;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: '01a0552a-54fd-7215-aaa3-99a775ae0f93',
  slug: 'backend-engineer-at-acme-5a639ec9',
  title: 'Backend Engineer',
  url: 'https://4dayweek.io/job/backend-engineer-at-acme-5a639ec9',
  description: '**Backend Engineer**\n\nBuild services.\n\n- Node.js\n- Postgres',
  posted_at: '2026-08-31T00:13:53Z',
  company: { name: 'Acme', slug: 'acme' },
  locations: [
    { city: 'Ipswich', country: 'United Kingdom', work_arrangement: 'hybrid' },
  ],
  work_arrangement: 'hybrid',
  contract_type: 'permanent',
  level: 'mid',
  hours_per_week_min: 32,
  hours_per_week_max: 32,
  salary_min: 4200000,
  salary_max: 5000000,
  salary_currency: 'GBP',
  salary_period: 'year',
  ...overrides,
});

describe('mapFourDayWeekPage', () => {
  it('maps a row, converting salary from minor units', () => {
    const { jobs } = mapFourDayWeekPage(
      { data: [row()], page: 1, has_more: true },
      COMPANY_ID,
    );
    const job = jobs[0]!;
    assert.equal(job.externalId, '01a0552a-54fd-7215-aaa3-99a775ae0f93');
    assert.equal(job.title, 'Backend Engineer');
    assert.equal(job.location, 'Hybrid · Ipswich, United Kingdom');
    assert.equal(job.postedAt.toISOString(), '2026-08-31T00:13:53.000Z');
    assert.match(job.description, /Hiring company: Acme\./);
    assert.match(job.description, /Salary: 42000-50000 GBP \(year\)\./);
    assert.match(job.description, /Hours: 32\/week\./);
  });

  it('keeps markdown newlines intact (no tag-strip on plaintext)', () => {
    const { jobs } = mapFourDayWeekPage({ data: [row()] }, COMPANY_ID);
    assert.match(jobs[0]!.description, /Build services\.\n\n- Node\.js\n- Postgres/);
  });

  it('propagates has_more for the pagination loop', () => {
    assert.equal(
      mapFourDayWeekPage({ data: [], has_more: true }, COMPANY_ID).hasMore,
      true,
    );
    assert.equal(
      mapFourDayWeekPage({ data: [] }, COMPANY_ID).hasMore,
      false,
    );
  });

  it('returns empty for an empty page or a non-conforming payload', () => {
    assert.deepEqual(mapFourDayWeekPage({ data: [] }, COMPANY_ID).jobs, []);
    assert.deepEqual(mapFourDayWeekPage(null, COMPANY_ID).jobs, []);
    assert.deepEqual(mapFourDayWeekPage('oops', COMPANY_ID).jobs, []);
  });

  it('skips a malformed row, keeps the valid ones', () => {
    const { jobs } = mapFourDayWeekPage(
      { data: [{ id: 42 }, row(), null] },
      COMPANY_ID,
    );
    assert.equal(jobs.length, 1);
  });

  it('handles rows without salary or locations', () => {
    const { jobs } = mapFourDayWeekPage(
      {
        data: [
          row({
            salary_min: null,
            salary_max: null,
            locations: [],
            work_arrangement: 'remote_anywhere',
          }),
        ],
      },
      COMPANY_ID,
    );
    assert.equal(jobs[0]!.location, 'Remote');
    assert.doesNotMatch(jobs[0]!.description, /Salary:/);
  });
});

describe('mapFourDayWeekPage — location hints (ADR 0031)', () => {
  it('resolves the geocoded country names and the arrangement', () => {
    // Recorded live 2026-09-03: a primary office plus a country-wide remote entry.
    const { jobs } = mapFourDayWeekPage(
      {
        data: [
          row({
            work_arrangement: 'remote',
            locations: [
              { city: 'Herndon', state: 'Virginia', country: 'United States', work_arrangement: 'onsite', is_primary: true },
              { country: 'United States', work_arrangement: 'remote' },
            ],
          }),
        ],
      },
      COMPANY_ID,
    );
    assert.deepEqual(jobs[0]?.locationHints, { countries: ['US', 'US'], workplace: 'REMOTE' });
    assert.deepEqual(mapFourDayWeekPage({ data: [row()] }, COMPANY_ID).jobs[0]?.locationHints, {
      countries: ['GB'],
      workplace: 'HYBRID',
    });
  });
});
