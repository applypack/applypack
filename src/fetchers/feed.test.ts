import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { feedUrl, looksLikeFeed, mapFeedItem } from './feed';

describe('feedUrl', () => {
  it('accepts a public http(s) feed URL', () => {
    assert.equal(feedUrl('https://www.python.org/jobs/feed/rss/'), 'https://www.python.org/jobs/feed/rss/');
    assert.equal(feedUrl('  https://example.com/jobs.rss  '), 'https://example.com/jobs.rss');
  });

  it('refuses a private address — the token reaches fetch, so the SSRF guard runs here too', () => {
    for (const bad of [
      'http://127.0.0.1/jobs.rss',
      'http://localhost:3000/feed',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/jobs.rss',
      'http://[::1]/jobs.rss',
    ]) {
      assert.throws(() => feedUrl(bad), /feed:/, bad);
    }
  });

  it('refuses an ADR 0005 host and a non-http scheme', () => {
    assert.throws(() => feedUrl('https://www.linkedin.com/jobs.rss'), /ADR 0005/);
    assert.throws(() => feedUrl('file:///etc/passwd'), /http/);
    assert.throws(() => feedUrl('not a url'), /URL/);
  });
});

describe('looksLikeFeed', () => {
  it('recognises RSS and Atom, and nothing else', () => {
    assert.equal(looksLikeFeed('<?xml version="1.0"?><rss version="2.0"><channel/></rss>'), true);
    assert.equal(looksLikeFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true);
    assert.equal(looksLikeFeed('<!DOCTYPE html><html><body>Careers</body></html>'), false);
    assert.equal(looksLikeFeed('{"jobs":[]}'), false);
  });

  it('does not scan a whole megabyte of HTML for the word', () => {
    assert.equal(looksLikeFeed(`${'x'.repeat(5_000)}<rss>`), false);
  });
});

describe('mapFeedItem', () => {
  const item = {
    title: 'Senior TypeScript Engineer',
    link: 'https://example.com/jobs/42',
    guid: 'urn:uuid:42',
    isoDate: '2026-09-01T10:00:00.000Z',
    content: '<p>We use <b>Node.js</b> &amp; React.</p><ul><li>Remote</li></ul>',
    categories: ['Engineering', ' Remote '],
  };

  it('maps a well-formed item', () => {
    const job = mapFeedItem(item, 7);
    assert.ok(job);
    assert.equal(job.companyId, 7);
    assert.equal(job.title, 'Senior TypeScript Engineer');
    assert.equal(job.url, 'https://example.com/jobs/42');
    assert.equal(job.postedAt.toISOString(), '2026-09-01T10:00:00.000Z');
  });

  it('decodes entities and rebuilds the list, so the classifier reads prose', () => {
    const job = mapFeedItem(item, 7);
    assert.ok(job);
    assert.ok(job.description.includes('Node.js & React.'));
    assert.ok(job.description.includes('• Remote'));
    assert.ok(!job.description.includes('<'));
  });

  it('appends the feed categories as one line', () => {
    assert.ok(mapFeedItem(item, 7)?.description.endsWith('Tags: Engineering, Remote.'));
  });

  it('leaves the location empty — a feed publishes none, and a guess is worse than nothing', () => {
    assert.equal(mapFeedItem(item, 7)?.location, '');
  });

  it('gives the same item the same id across runs, and different items different ids', () => {
    const a = mapFeedItem(item, 7)?.externalId;
    const b = mapFeedItem({ ...item }, 7)?.externalId;
    const c = mapFeedItem({ ...item, link: 'https://example.com/jobs/43' }, 7)?.externalId;
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it('falls back to guid and title when the item has no link', () => {
    const job = mapFeedItem({ title: 'Engineer', guid: 'abc-123' }, 7);
    assert.ok(job);
    assert.equal(job.url, '');
    assert.ok(job.externalId.length > 0);
  });

  it('skips a row that identifies nothing rather than merging them all onto one id', () => {
    assert.equal(mapFeedItem({ title: 'Engineer' }, 7)?.externalId !== undefined, true);
    assert.equal(mapFeedItem({ link: '', guid: '', title: '' }, 7), null);
    assert.equal(mapFeedItem({}, 7), null);
  });

  it('skips a titleless row — every list in the product would show "Untitled"', () => {
    assert.equal(mapFeedItem({ link: 'https://example.com/jobs/9', title: '  ' }, 7), null);
  });

  it('falls back to now when the date is missing or unparseable', () => {
    const before = Date.now();
    for (const dates of [{}, { pubDate: 'last tuesday' }]) {
      const job = mapFeedItem({ title: 'Engineer', link: 'https://example.com/1', ...dates }, 7);
      assert.ok(job && job.postedAt.getTime() >= before);
    }
  });

  it('prefers isoDate over pubDate', () => {
    const job = mapFeedItem(
      { title: 'E', link: 'https://example.com/1', isoDate: '2026-01-01T00:00:00.000Z', pubDate: 'Tue, 02 Feb 2027 00:00:00 GMT' },
      7,
    );
    assert.equal(job?.postedAt.toISOString(), '2026-01-01T00:00:00.000Z');
  });
});
