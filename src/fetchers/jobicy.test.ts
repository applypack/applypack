import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOBICY_GEO, jobicyFeedUrl, jobicySlugsFor, mapJobicyItem, readJobicyFeed } from './jobicy';

const COMPANY_ID = 99;

// One item of the dev feed, recorded on 2026-10-29, `content:encoded` trimmed.
const FEED = readFileSync(join(__dirname, 'fixtures', 'jobicy-feed.xml'), 'utf8');

describe('Jobicy — the recorded posting, whole (#658)', () => {
  it('reads content:encoded, not the 250-character excerpt, and the salary fields', async () => {
    const [item] = await readJobicyFeed(FEED);
    const job = mustmapJobicyItem(item!, COMPANY_ID);
    assert.match(job.description, /^Hiring company: Future PLC\. Type: full time\. Salary: 200000-230000 USD \(yearly\)\.\n\n/);
    assert.match(job.description, /You have:/);
    assert.match(job.description, /8\+ years of production development experience/);
    assert.match(job.description, /Strong knowledge of Go, AWS, Docker \(ECS\), Postgres \(RDS\)/);
    assert.doesNotMatch(job.description, /then\.\.\./);
    assert.equal(job.location, 'USA');
    assert.equal(job.employer, 'Future PLC');
  });

  it('keeps the excerpt for an item without the full body, and no salary line without a bound', () => {
    const job = mustmapJobicyItem(
      { title: 'X', link: 'https://jobicy.com/jobs/1', contentSnippet: 'An excerpt…', salaryCurrency: 'USD', salaryPeriod: 'yearly' },
      COMPANY_ID,
    );
    assert.equal(job.description, 'An excerpt…');
  });
});

describe('mapJobicyItem', () => {
  it('extracts <job_listing:location> instead of defaulting to Remote', () => {
    const job = mustmapJobicyItem(
      {
        title: 'Senior PHP Developer',
        link: 'https://jobicy.com/jobs/142345-senior-php',
        pubDate: 'Mon, 28 Apr 2026 04:14:43 +0000',
        jobLocation: 'USA',
      },
      COMPANY_ID,
    );
    assert.equal(job.location, 'USA');
  });

  it('falls back to "Remote" when location field is missing or empty', () => {
    const a = mustmapJobicyItem(
      {
        title: 'X',
        link: 'https://jobicy.com/jobs/1',
        pubDate: 'Mon, 28 Apr 2026 04:14:43 +0000',
      },
      COMPANY_ID,
    );
    assert.equal(a.location, 'Remote');
    const b = mustmapJobicyItem(
      {
        title: 'X',
        link: 'https://jobicy.com/jobs/1',
        pubDate: 'Mon, 28 Apr 2026 04:14:43 +0000',
        jobLocation: '   ',
      },
      COMPANY_ID,
    );
    assert.equal(b.location, 'Remote');
  });

  it('embeds hiring company + job type into description', () => {
    const job = mustmapJobicyItem(
      {
        title: 'Senior SAP Integration Developer',
        link: 'https://jobicy.com/jobs/142515',
        pubDate: 'Fri, 24 Apr 2026 15:07:31 +0000',
        jobLocation: 'USA',
        jobCompany: 'ManTech',
        jobType: 'Full Time',
        contentSnippet: 'Shape the future of defense with MANTECH!',
      },
      COMPANY_ID,
    );
    assert.match(job.description, /Hiring company: ManTech/);
    assert.match(job.description, /Type: full time/);
    assert.match(job.description, /Shape the future of defense/);
  });

  it('preserves description when no custom fields are set', () => {
    const job = mustmapJobicyItem(
      {
        title: 'X',
        link: 'https://jobicy.com/jobs/1',
        pubDate: 'Mon, 28 Apr 2026 04:14:43 +0000',
        contentSnippet: 'Just a description.',
      },
      COMPANY_ID,
    );
    assert.equal(job.description, 'Just a description.');
  });

  it('uses guid for externalId when present', () => {
    const job = mustmapJobicyItem(
      {
        title: 'X',
        link: 'https://jobicy.com/jobs/142345',
        pubDate: 'Mon, 28 Apr 2026 04:14:43 +0000',
        guid: 'https://jobicy.com/jobs/142345',
      },
      COMPANY_ID,
    );
    assert.equal(job.externalId, 'https://jobicy.com/jobs/142345');
  });

  it('synthesises a stable externalId from link when guid is missing', () => {
    const job = mustmapJobicyItem(
      {
        title: 'X',
        link: 'https://jobicy.com/jobs/142345',
        pubDate: 'Mon, 28 Apr 2026 04:14:43 +0000',
      },
      COMPANY_ID,
    );
    assert.equal(job.externalId.length, 16);
    assert.match(job.externalId, /^[0-9a-f]{16}$/);
  });

  it('handles empty contentSnippet without crashing', () => {
    const job = mustmapJobicyItem(
      {
        title: 'X',
        link: 'https://jobicy.com/jobs/1',
        pubDate: 'Mon, 28 Apr 2026 04:14:43 +0000',
        contentSnippet: '',
        jobCompany: 'Acme Inc',
      },
      COMPANY_ID,
    );
    assert.equal(job.description, 'Hiring company: Acme Inc.');
  });
});

/** The mapper returns null only for rows nothing identifies; every fixture
 *  here is keyable, so assert that before the per-field checks. */
function mustmapJobicyItem(...args: Parameters<typeof mapJobicyItem>): NonNullable<ReturnType<typeof mapJobicyItem>> {
  const job = mapJobicyItem(...args);
  assert.ok(job, 'expected the fixture to map to a job');
  return job;
}

describe('mapJobicyItem — location hints (ADR 0031)', () => {
  it('marks the board remote; the vocabulary stays in the string', () => {
    const job = mustmapJobicyItem(
      { title: 'X', link: 'https://jobicy.com/jobs/1', guid: '1', jobLocation: 'Europe, Norway' },
      COMPANY_ID,
    );
    assert.equal(job.location, 'Europe, Norway');
    assert.deepEqual(job.locationHints, { workplace: 'REMOTE' });
  });
});

describe('jobicySlugsFor — the feeds a set of searches needs (stage 3a)', () => {
  it('maps countries and groups to the slugs Jobicy knows, once each', () => {
    assert.deepEqual(jobicySlugsFor({ countries: ['PL', 'DE', 'GB'], regions: ['EU', 'EUROPE'] }), ['poland', 'germany', 'uk', 'europe']);
  });

  it('drops places Jobicy has no slug for, and an empty context means the whole feed', () => {
    assert.deepEqual(jobicySlugsFor({ countries: ['LT', 'PL'], regions: ['DACH'] }), ['poland']);
    assert.deepEqual(jobicySlugsFor({ countries: [], regions: [] }), []);
  });

  it('builds the feed URL with and without a geo', () => {
    assert.equal(jobicyFeedUrl('dev', null), 'https://jobicy.com/?feed=job_feed&job_categories=dev');
    assert.equal(jobicyFeedUrl('dev', 'poland'), 'https://jobicy.com/?feed=job_feed&job_categories=dev&geo=poland');
  });

  it('every slug in the table is one the API echoed back on 2026-09-03', () => {
    const verified = ['usa', 'canada', 'uk', 'germany', 'poland', 'ukraine', 'netherlands', 'spain', 'france', 'europe', 'emea', 'latam', 'apac'];
    for (const slug of Object.values(JOBICY_GEO)) assert.ok(verified.includes(slug), slug);
  });
});
