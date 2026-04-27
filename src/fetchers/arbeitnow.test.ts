import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapArbeitnowFeed } from './arbeitnow';

describe('mapArbeitnowFeed', () => {
  it('parses a typical data payload', () => {
    const out = mapArbeitnowFeed(
      {
        data: [
          {
            slug: 'senior-php-acme-12345',
            company_name: 'Acme',
            title: 'Senior PHP Engineer',
            description: '<p>Build things.</p>',
            remote: true,
            url: 'https://www.arbeitnow.com/jobs/senior-php-acme-12345',
            tags: ['php', 'laravel'],
            location: 'Berlin',
            created_at: 1714000000,
          },
        ],
        links: {},
        meta: {},
      },
      11,
    );
    assert.equal(out.length, 1);
    const j = out[0]!;
    assert.equal(j.companyId, 11);
    assert.equal(j.externalId, 'senior-php-acme-12345');
    assert.equal(j.title, 'Senior PHP Engineer');
    assert.equal(j.url, 'https://www.arbeitnow.com/jobs/senior-php-acme-12345');
    assert.equal(j.location, 'Remote · Berlin');
    assert.equal(j.description, 'Build things.');
    assert.equal(j.postedAt.getTime(), 1714000000 * 1000);
  });

  it('returns [] when payload has no data key', () => {
    assert.deepEqual(mapArbeitnowFeed({}, 1), []);
    assert.deepEqual(mapArbeitnowFeed(null, 1), []);
  });

  it('hashes a fallback id when slug is missing', () => {
    const out = mapArbeitnowFeed(
      {
        data: [
          {
            title: 'Junior Dev',
            company_name: 'NoSlug Inc',
            description: '',
            remote: false,
          },
        ],
      },
      1,
    );
    assert.equal(out.length, 1);
    assert.ok(out[0]!.externalId.length === 16); // hashShortId returns 16-char hex
  });

  it('does not prefix Remote when remote=false', () => {
    const out = mapArbeitnowFeed(
      {
        data: [
          {
            slug: 's',
            title: 't',
            description: '',
            remote: false,
            location: 'Berlin',
          },
        ],
      },
      1,
    );
    assert.equal(out[0]!.location, 'Berlin');
  });

  it('returns "Remote" when remote=true and location is empty', () => {
    const out = mapArbeitnowFeed(
      {
        data: [
          {
            slug: 's',
            title: 't',
            description: '',
            remote: true,
            location: '',
          },
        ],
      },
      1,
    );
    assert.equal(out[0]!.location, 'Remote');
  });

  it('skips entries that fail schema validation (missing title)', () => {
    const out = mapArbeitnowFeed(
      { data: [{ slug: 's', description: '' }] },
      1,
    );
    assert.deepEqual(out, []);
  });

  it('does not duplicate "Remote" when location already says it', () => {
    const out = mapArbeitnowFeed(
      {
        data: [
          {
            slug: 's',
            title: 't',
            description: '',
            remote: true,
            location: 'Remote, Germany',
          },
        ],
      },
      1,
    );
    assert.equal(out[0]!.location, 'Remote, Germany');
  });
});
