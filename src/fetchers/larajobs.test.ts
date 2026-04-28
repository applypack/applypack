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
    const job = mapLarajobsItem(item, COMPANY_ID);
    assert.equal(job.location, 'United States/Remote (USA Only)');
  });

  it('falls back to "Remote" when <job:location> is missing or empty', () => {
    const a = mapLarajobsItem(
      {
        title: 'X',
        link: 'https://larajobs.com/job/1',
        pubDate: 'Wed, 22 Apr 2026 20:47:36 +0000',
      },
      COMPANY_ID,
    );
    assert.equal(a.location, 'Remote');

    const b = mapLarajobsItem(
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
    const job = mapLarajobsItem(
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
    const job = mapLarajobsItem(
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
    const job = mapLarajobsItem(
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
    const job = mapLarajobsItem(
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
    const job = mapLarajobsItem(
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
