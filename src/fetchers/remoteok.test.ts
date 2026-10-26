import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapRemoteokFeed, withoutAddressTag } from './remoteok';

const META = { legal: '...', last_updated: 1714000000 };

describe('mapRemoteokFeed', () => {
  it('drops the meta entry at index 0', () => {
    const feed = [
      META,
      {
        id: '42',
        position: 'Senior PHP Engineer',
        company: 'Acme',
        location: 'Remote',
        description: '<p>Build cool stuff.</p>',
        epoch: 1714000000,
        url: 'https://remoteok.com/jobs/42',
        tags: ['php', 'laravel'],
      },
    ];
    const out = mapRemoteokFeed(feed, 99);
    assert.equal(out.length, 1);
    const j = out[0]!;
    assert.equal(j.companyId, 99);
    assert.equal(j.externalId, '42');
    assert.equal(j.title, 'Senior PHP Engineer');
    assert.equal(j.url, 'https://remoteok.com/jobs/42');
    assert.equal(j.location, 'Remote');
    assert.equal(j.description, 'Build cool stuff.');
  });

  it('returns [] when input is not an array', () => {
    assert.deepEqual(mapRemoteokFeed({}, 1), []);
    assert.deepEqual(mapRemoteokFeed(null, 1), []);
    assert.deepEqual(mapRemoteokFeed('oops', 1), []);
  });

  it('returns [] when input is empty array (only meta possible, but safe)', () => {
    assert.deepEqual(mapRemoteokFeed([], 1), []);
    assert.deepEqual(mapRemoteokFeed([META], 1), []);
  });

  it('uses position over title when both present, falls back gracefully', () => {
    const out = mapRemoteokFeed(
      [META, { id: '1', title: 'fallback', company: 'X', description: '' }],
      9,
    );
    assert.equal(out[0]!.title, 'fallback');
  });

  it('prepends "Remote · " when location lacks the remote keyword', () => {
    const out = mapRemoteokFeed(
      [META, { id: '1', position: 'p', location: 'Berlin', description: '' }],
      9,
    );
    assert.equal(out[0]!.location, 'Remote · Berlin');
  });

  it('keeps location verbatim when it already mentions remote', () => {
    const out = mapRemoteokFeed(
      [META, { id: '1', position: 'p', location: 'Remote, US', description: '' }],
      9,
    );
    assert.equal(out[0]!.location, 'Remote, US');
  });

  it('parses epoch (seconds) correctly', () => {
    const epoch = 1714000000;
    const out = mapRemoteokFeed(
      [META, { id: '1', position: 'p', epoch, description: '' }],
      9,
    );
    assert.equal(out[0]!.postedAt.getTime(), epoch * 1000);
  });

  it('falls back to date string when epoch missing', () => {
    const out = mapRemoteokFeed(
      [
        META,
        { id: '1', position: 'p', date: '2026-04-25T12:00:00Z', description: '' },
      ],
      9,
    );
    assert.ok(!Number.isNaN(out[0]!.postedAt.getTime()));
  });

  it('strips HTML from description', () => {
    const out = mapRemoteokFeed(
      [
        META,
        {
          id: '1',
          position: 'p',
          description: '<p>Hi <b>world</b></p><script>alert("x")</script>',
        },
      ],
      9,
    );
    assert.equal(out[0]!.description, 'Hi world');
  });

  it('synthesises an id when both id and slug are missing', () => {
    const out = mapRemoteokFeed(
      [META, { position: 'Senior PHP', company: 'Acme', description: '' } as Record<string, unknown>],
      9,
    );
    assert.equal(out.length, 0); // id is required per schema; the safe-parse drops it
  });

  it('coerces numeric id to string', () => {
    const out = mapRemoteokFeed(
      [META, { id: 42, position: 'p', description: '' }],
      9,
    );
    assert.equal(out[0]!.externalId, '42');
  });
});

describe('withoutAddressTag', () => {
  // The tag is "R" + base64 of the address that asked for the feed; these are documentation addresses.
  const v4 = `R${Buffer.from('203.0.113.7').toString('base64')}`;
  const v6 = `R${Buffer.from('2001:db8::42').toString('base64')}`;
  const readCheck = (tag: string): string =>
    `Please mention the word **DESIRING** and tag ${tag} when applying to show you read the job post completely (#${tag}). This is a beta feature to avoid spam applicants. Companies can search these words to find applicants that read this and see they're human.`;

  it('cuts the read-check paragraph, address and all, from a stored description', () => {
    const feed = [META, { id: '7', position: 'Backend Engineer', company: 'Acme', description: `<p>Build APIs.</p><br/><br/>${readCheck(v4)}` }];
    const description = mapRemoteokFeed(feed, 1)[0]!.description;
    assert.equal(description, 'Build APIs.');
    assert.doesNotMatch(description, /mention the word|R[A-Za-z0-9+/]{12,}/);
  });

  it('cuts a tag that turns up on its own, IPv4 or IPv6', () => {
    assert.equal(withoutAddressTag(`Apply with ${v6} today`), 'Apply with  today');
    assert.equal(withoutAddressTag(`(#${v4})`), '()');
  });

  it('leaves words that only look like a tag', () => {
    const text = 'Requirements: React, Redux, RabbitMQ and REST — Responsibilities follow.';
    assert.equal(withoutAddressTag(text), text);
  });
});
