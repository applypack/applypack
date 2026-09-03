import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapRemotiveFeed } from './remotive';

describe('mapRemotiveFeed', () => {
  it('parses a typical jobs payload', () => {
    const out = mapRemotiveFeed(
      {
        '00-warning': '...',
        jobs: [
          {
            id: 12345,
            url: 'https://remotive.com/x/12345',
            title: 'Senior Full-Stack Engineer',
            company_name: 'Acme',
            tags: ['php', 'laravel'],
            publication_date: '2026-04-20T12:00:00',
            candidate_required_location: 'USA timezones',
            description: '<p>Build things.</p>',
          },
        ],
      },
      7,
    );
    assert.equal(out.length, 1);
    const j = out[0]!;
    assert.equal(j.companyId, 7);
    assert.equal(j.externalId, '12345');
    assert.equal(j.title, 'Senior Full-Stack Engineer');
    assert.equal(j.url, 'https://remotive.com/x/12345');
    assert.equal(j.location, 'Remote · USA timezones');
    assert.equal(j.description, 'Build things.');
  });

  it('returns [] when payload has no jobs key', () => {
    assert.deepEqual(mapRemotiveFeed({}, 1), []);
    assert.deepEqual(mapRemotiveFeed(null, 1), []);
  });

  it('falls back to "Remote" when candidate_required_location is empty', () => {
    const out = mapRemotiveFeed(
      {
        jobs: [
          {
            id: 1,
            title: 't',
            candidate_required_location: '',
            description: '',
          },
        ],
      },
      1,
    );
    assert.equal(out[0]!.location, 'Remote');
  });

  it('keeps location verbatim if it already mentions remote', () => {
    const out = mapRemotiveFeed(
      {
        jobs: [
          {
            id: 1,
            title: 't',
            candidate_required_location: 'Remote, EU',
            description: '',
          },
        ],
      },
      1,
    );
    assert.equal(out[0]!.location, 'Remote, EU');
  });

  it('skips jobs whose schema does not validate (missing title)', () => {
    const out = mapRemotiveFeed(
      { jobs: [{ id: 1, description: '' }] },
      1,
    );
    assert.deepEqual(out, []);
  });

  it('falls back to now() when publication_date missing or invalid', () => {
    const before = Date.now();
    const out = mapRemotiveFeed(
      { jobs: [{ id: 1, title: 't', description: '' }] },
      1,
    );
    const after = Date.now();
    assert.ok(out[0]!.postedAt.getTime() >= before);
    assert.ok(out[0]!.postedAt.getTime() <= after);
  });

  it('coerces numeric id to string', () => {
    const out = mapRemotiveFeed(
      { jobs: [{ id: 12345, title: 't', description: '' }] },
      1,
    );
    assert.equal(out[0]!.externalId, '12345');
  });
});

describe('mapRemotiveFeed — location hints (ADR 0031)', () => {
  it('marks the board remote and leaves the countries to the parser', () => {
    const out = mapRemotiveFeed(
      { jobs: [{ id: 5, title: 'X', candidate_required_location: 'LATAM, Europe, USA', description: '' }] },
      1,
    );
    assert.equal(out[0]?.location, 'Remote · LATAM, Europe, USA');
    assert.deepEqual(out[0]?.locationHints, { workplace: 'REMOTE' });
  });
});
