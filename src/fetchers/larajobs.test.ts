import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapLarajobsItem, type LarajobsItem } from './larajobs';

const COMPANY_ID = 23;

describe('mapLarajobsItem', () => {
  it('extracts <job:location> instead of defaulting to Remote', () => {
    const item: LarajobsItem = {
      title: 'Senior Laravel Developer',
      link: 'https://larajobs.com/job/3869',
      pubDate: 'Thu, 16 Apr 2026 15:01:42 +0000',
      jobLocation: 'United States/Remote (USA Only)',
    };
    const job = mustmapLarajobsItem(item, COMPANY_ID);
    assert.equal(job.location, 'United States/Remote (USA Only)');
  });

  it('falls back to "Remote" when <job:location> is missing or empty', () => {
    const a = mustmapLarajobsItem(
      {
        title: 'X',
        link: 'https://larajobs.com/job/1',
        pubDate: 'Wed, 22 Apr 2026 20:47:36 +0000',
      },
      COMPANY_ID,
    );
    assert.equal(a.location, 'Remote');

    const b = mustmapLarajobsItem(
      {
        title: 'X',
        link: 'https://larajobs.com/job/1',
        pubDate: 'Wed, 22 Apr 2026 20:47:36 +0000',
        jobLocation: '   ',
      },
      COMPANY_ID,
    );
    assert.equal(b.location, 'Remote');
  });

  it('embeds salary / company / tags / type into description', () => {
    const job = mustmapLarajobsItem(
      {
        title: 'Senior Laravel/Vue Engineer',
        link: 'https://larajobs.com/job/3869',
        pubDate: 'Thu, 16 Apr 2026 15:01:42 +0000',
        jobLocation: 'United States/Remote',
        jobSalary: 'USD 130,000 - 160,000',
        jobCompany: 'Orpical Technology Solutions',
        jobTags: 'laravel,vue,inertia',
        jobJobType: 'FULL_TIME',
        contentSnippet: 'Help us build an AI-native Laravel monolith.',
      },
      COMPANY_ID,
    );
    assert.match(job.description, /Hiring company: Orpical Technology Solutions/);
    assert.match(job.description, /Salary: USD 130,000 - 160,000/);
    assert.match(job.description, /Tags: laravel,vue,inertia/);
    assert.match(job.description, /Type: full time/);
    assert.match(job.description, /AI-native Laravel monolith/);
  });

  it('preserves original description when no custom fields present', () => {
    const job = mustmapLarajobsItem(
      {
        title: 'Senior Laravel Developer',
        link: 'https://larajobs.com/job/1',
        pubDate: 'Wed, 22 Apr 2026 20:47:36 +0000',
        contentSnippet: 'Original body only.',
      },
      COMPANY_ID,
    );
    assert.equal(job.description, 'Original body only.');
  });

  it('handles empty contentSnippet without crashing', () => {
    const job = mustmapLarajobsItem(
      {
        title: 'X',
        link: 'https://larajobs.com/job/1',
        pubDate: 'Wed, 22 Apr 2026 20:47:36 +0000',
        contentSnippet: '',
        jobSalary: 'CAD 100,000 - 120,000',
      },
      COMPANY_ID,
    );
    assert.equal(job.description, 'Salary: CAD 100,000 - 120,000.');
  });

  it('uses guid for externalId when present', () => {
    const job = mustmapLarajobsItem(
      {
        title: 'X',
        link: 'https://larajobs.com/job/3869',
        pubDate: 'Thu, 16 Apr 2026 15:01:42 +0000',
        guid: 'https://larajobs.com/job/3869',
      },
      COMPANY_ID,
    );
    assert.equal(job.externalId, 'https://larajobs.com/job/3869');
  });

  it('synthesises a stable externalId from link when guid is absent', () => {
    const job = mustmapLarajobsItem(
      {
        title: 'X',
        link: 'https://larajobs.com/job/3869',
        pubDate: 'Thu, 16 Apr 2026 15:01:42 +0000',
      },
      COMPANY_ID,
    );
    assert.equal(job.externalId.length, 16);
    assert.match(job.externalId, /^[0-9a-f]{16}$/);
  });
});

describe('mapLarajobsItem keying', () => {
  it('drops a row that nothing identifies', () => {
  // No guid, no link, no title: hashing '' would give every such row the
  // same externalId and merge them into one job.
    assert.equal(mapLarajobsItem({ link: '', title: '' }, COMPANY_ID), null);
    assert.equal(mapLarajobsItem({}, COMPANY_ID), null);
  // A link alone is enough to key it.
    assert.ok(mapLarajobsItem({ link: 'https://larajobs.com/job/7' }, COMPANY_ID));
  });
});

/** The mapper returns null only for rows nothing identifies; every fixture
 *  here is keyable, so assert that before the per-field checks. */
function mustmapLarajobsItem(...args: Parameters<typeof mapLarajobsItem>): NonNullable<ReturnType<typeof mapLarajobsItem>> {
  const job = mapLarajobsItem(...args);
  assert.ok(job, 'expected the fixture to map to a job');
  return job;
}
