import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AtsType } from '@prisma/client';
import { MAX_HOST_REQUESTS, resolveCompanyUrl, type PageAnswer, type ResolveIo } from './resolve';

/*
 * Every page below reproduces something measured on 2026-09-04 against the
 * twenty-company fixture (docs/company-watchlist.md). The I/O is injected, so
 * these tests are the ladder's logic, not the network's mood.
 */

const RSS = (items: number) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${'<item><title>Role</title></item>'.repeat(items)}</channel></rss>`;

interface Stub {
  pages?: Record<string, Partial<PageAnswer>>;
  boards?: Record<string, number>;
}

function io(stub: Stub): ResolveIo & { asked: string[]; probed: string[] } {
  const asked: string[] = [];
  const probed: string[] = [];
  return {
    asked,
    probed,
    async get(url) {
      asked.push(url);
      const hit = stub.pages?.[url];
      return { status: hit?.status ?? 404, url: hit?.url ?? url, body: hit?.body ?? '' };
    },
    async probe(atsType, atsToken) {
      probed.push(`${atsType}:${atsToken}`);
      const jobs = stub.boards?.[`${atsType}:${atsToken}`];
      return jobs === undefined
        ? { ok: false, error: `HTTP 404 from ${atsType}` }
        : { ok: true, jobsCount: jobs };
    },
  };
}

const paste = (url: string) => ({ name: null, url });

describe('rung 1 — the pasted URL is already a board', () => {
  it('resolves without touching the site', async () => {
    const stub = io({ boards: { 'GREENHOUSE:netlify': 1 } });
    const r = await resolveCompanyUrl(paste('https://job-boards.greenhouse.io/netlify'), stub);
    assert.deepEqual(r.resolution, {
      kind: 'ats',
      atsType: AtsType.GREENHOUSE,
      atsToken: 'netlify',
      jobs: 1,
      via: 'https://job-boards.greenhouse.io/netlify',
    });
    assert.deepEqual(stub.asked, []);
    assert.equal(r.requests, 0);
  });

  // Measured: jobs.ashbyhq.com/Deno answers 200 while the posting API 404s.
  it('does not trust a board URL the vendor will not serve', async () => {
    const r = await resolveCompanyUrl(paste('https://jobs.ashbyhq.com/Deno'), io({}));
    assert.equal(r.resolution.kind, 'watchOnly');
    assert.match((r.resolution as { reason: string }).reason, /public posting API does not serve "deno"/i);
  });
});

describe('rung 2 — the URL redirects onto a board', () => {
  it('says an embed-only board is embed-only, rather than "nothing found"', async () => {
    const stub = io({
      pages: {
        'https://deno.com/robots.txt': { status: 404 },
        'https://deno.com/jobs': { status: 200, url: 'https://jobs.ashbyhq.com/Deno', body: '<html>SPA</html>' },
      },
    });
    const r = await resolveCompanyUrl(paste('https://deno.com/jobs'), stub);
    assert.equal(r.resolution.kind, 'watchOnly');
    assert.match((r.resolution as { reason: string }).reason, /embed-only/);
  });

  it('reads the landed URL (deno.com/jobs → jobs.ashbyhq.com/Deno)', async () => {
    const stub = io({
      pages: {
        'https://deno.com/robots.txt': { status: 404 },
        'https://deno.com/jobs': { status: 200, url: 'https://jobs.ashbyhq.com/Deno', body: '<html>SPA</html>' },
      },
      boards: { 'ASHBY:deno': 4 },
    });
    const r = await resolveCompanyUrl(paste('https://deno.com/jobs'), stub);
    assert.equal(r.resolution.kind, 'ats');
    assert.equal(r.careerUrl, 'https://jobs.ashbyhq.com/Deno');
  });
});

describe('rung 3 — the page links to a board', () => {
  const page = (body: string) => ({
    'https://www.netlify.com/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
    'https://www.netlify.com/careers/': { status: 200, body },
  });

  it('confirms the board with the vendor before accepting it', async () => {
    const stub = io({
      pages: page('<a href="https://job-boards.greenhouse.io/netlify/jobs/4224129002">Role</a>'),
      boards: { 'GREENHOUSE:netlify': 1 },
    });
    const r = await resolveCompanyUrl(paste('https://www.netlify.com/careers/'), stub);
    assert.equal(r.resolution.kind, 'ats');
    assert.deepEqual(stub.probed, ['GREENHOUSE:netlify']);
    assert.equal(r.requests, 2);
  });

  it('falls through to watchOnly when the linked board does not resolve', async () => {
    const stub = io({ pages: page('<a href="https://job-boards.greenhouse.io/ghost">Role</a>') });
    const r = await resolveCompanyUrl(paste('https://www.netlify.com/careers/'), stub);
    assert.equal(r.resolution.kind, 'watchOnly');
  });

  it('names the row from the host when the user gave no name', async () => {
    const stub = io({
      pages: page('<a href="https://job-boards.greenhouse.io/netlify">Role</a>'),
      boards: { 'GREENHOUSE:netlify': 1 },
    });
    assert.equal((await resolveCompanyUrl(paste('https://www.netlify.com/careers/'), stub)).name, 'Netlify');
  });

  it('keeps the name the user typed', async () => {
    const stub = io({
      pages: page('<a href="https://job-boards.greenhouse.io/netlify">Role</a>'),
      boards: { 'GREENHOUSE:netlify': 1 },
    });
    const r = await resolveCompanyUrl({ name: 'Netlify (EU)', url: 'https://www.netlify.com/careers/' }, stub);
    assert.equal(r.name, 'Netlify (EU)');
  });
});

describe('rung 4 — a feed', () => {
  const robots = { 'https://acme.com/robots.txt': { status: 404 } };

  it('takes a declared feed whose own path names jobs', async () => {
    const stub = io({
      pages: {
        ...robots,
        'https://acme.com/careers': {
          status: 200,
          body: '<link rel="alternate" type="application/rss+xml" href="/jobs.rss">',
        },
        'https://acme.com/jobs.rss': { status: 200, body: RSS(12) },
      },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.deepEqual(r.resolution, { kind: 'feed', url: 'https://acme.com/jobs.rss', items: 12, via: 'https://acme.com/jobs.rss' });
  });

  it('never fetches a declared blog feed (posthog.com declares /rss.xml)', async () => {
    const stub = io({
      pages: {
        ...robots,
        'https://acme.com/careers': {
          status: 200,
          body: '<link rel="alternate" type="application/rss+xml" href="/rss.xml">',
        },
        'https://acme.com/rss.xml': { status: 200, body: RSS(253) },
      },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(r.resolution.kind, 'watchOnly');
    assert.equal(stub.asked.includes('https://acme.com/rss.xml'), false);
  });

  // Measured on automattic.com: WordPress answers a well-formed, item-less
  // feed at any /<x>/feed, so "200 and parses" is not evidence of a source.
  it('rejects a valid feed that carries no entries', async () => {
    const stub = io({
      pages: {
        ...robots,
        'https://acme.com/careers': { status: 200, body: '<h1>Work with us</h1>' },
        'https://acme.com/jobs.rss': { status: 200, body: RSS(0) },
        'https://acme.com/jobs/feed': { status: 200, body: RSS(0) },
        'https://acme.com/careers/feed': { status: 200, body: RSS(0) },
      },
    });
    assert.equal((await resolveCompanyUrl(paste('https://acme.com/careers'), stub)).resolution.kind, 'watchOnly');
  });

  it('tries the well-known job paths when nothing was declared', async () => {
    const stub = io({
      pages: {
        ...robots,
        'https://acme.com/careers': { status: 200, body: '<h1>Work with us</h1>' },
        'https://acme.com/jobs/feed': { status: 200, body: RSS(3) },
      },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(r.resolution.kind, 'feed');
    assert.equal((r.resolution as { url: string }).url, 'https://acme.com/jobs/feed');
  });

  it('ignores a page that answers HTML at a feed path', async () => {
    const stub = io({
      pages: {
        ...robots,
        'https://acme.com/careers': { status: 200, body: '<h1>Work with us</h1>' },
        'https://acme.com/jobs.rss': { status: 200, body: '<!DOCTYPE html><h1>Not found</h1>' },
      },
    });
    assert.equal((await resolveCompanyUrl(paste('https://acme.com/careers'), stub)).resolution.kind, 'watchOnly');
  });

  // A declared href is content from a page we just fetched, so it is
  // untrusted: `<link rel="alternate" href="http://169.254.169.254/…">` is a
  // perfectly valid tag.
  it('never fetches a declared feed that points at a private address', async () => {
    const stub = io({
      pages: {
        ...robots,
        'https://acme.com/careers': {
          status: 200,
          body: '<link rel="alternate" type="application/rss+xml" href="http://169.254.169.254/jobs.rss">',
        },
        'http://169.254.169.254/jobs.rss': { status: 200, body: RSS(5) },
      },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(r.resolution.kind, 'watchOnly');
    assert.equal(stub.asked.includes('http://169.254.169.254/jobs.rss'), false);
  });

  it('never fetches a declared feed on an ADR 0005 host', async () => {
    const stub = io({
      pages: {
        ...robots,
        'https://acme.com/careers': {
          status: 200,
          body: '<link rel="alternate" type="application/rss+xml" href="https://www.linkedin.com/jobs.rss">',
        },
      },
    });
    await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(stub.asked.some((u) => u.includes('linkedin')), false);
  });

  it('drops a feed whose answer came from somewhere it may not fetch', async () => {
    const stub = io({
      pages: {
        ...robots,
        'https://acme.com/careers': { status: 200, body: '<h1>Work with us</h1>' },
        // A public feed URL that redirects into the private range.
        'https://acme.com/jobs.rss': { status: 200, url: 'http://10.0.0.5/jobs.rss', body: RSS(9) },
      },
    });
    assert.equal((await resolveCompanyUrl(paste('https://acme.com/careers'), stub)).resolution.kind, 'watchOnly');
  });

  it('spends at most MAX_HOST_REQUESTS on the site', async () => {
    const stub = io({
      pages: { ...robots, 'https://acme.com/careers': { status: 200, body: '<h1>Work with us</h1>' } },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.ok(r.requests <= MAX_HOST_REQUESTS, `spent ${r.requests}`);
    assert.equal(stub.asked.length, r.requests);
  });
});

describe('refusals', () => {
  it('refuses an ADR 0005 host before any request', async () => {
    const stub = io({});
    const r = await resolveCompanyUrl(paste('https://www.linkedin.com/company/acme/jobs/'), stub);
    assert.equal(r.resolution.kind, 'refused');
    assert.match((r.resolution as { reason: string }).reason, /ADR 0005/);
    assert.deepEqual(stub.asked, []);
  });

  it('refuses a private address', async () => {
    for (const url of ['http://127.0.0.1:8080/careers', 'http://10.1.2.3/jobs', 'http://169.254.169.254/']) {
      const r = await resolveCompanyUrl(paste(url), io({}));
      assert.equal(r.resolution.kind, 'refused', url);
    }
  });

  it('refuses a public URL that redirects onto a private one', async () => {
    const stub = io({
      pages: {
        'https://acme.com/robots.txt': { status: 404 },
        'https://acme.com/careers': { status: 200, url: 'http://169.254.169.254/latest/meta-data/', body: 'x' },
      },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(r.resolution.kind, 'refused');
    assert.match((r.resolution as { reason: string }).reason, /public/i);
  });

  it('refuses a path robots.txt disallows, and does not fetch the page', async () => {
    const stub = io({
      pages: { 'https://acme.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /careers' } },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(r.resolution.kind, 'refused');
    assert.deepEqual(stub.asked, ['https://acme.com/robots.txt']);
  });

  it('refuses a path an AI bot is banned from (ADR 0005 addendum rule 2)', async () => {
    const stub = io({
      pages: {
        'https://acme.com/robots.txt': { status: 200, body: 'User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nAllow: /' },
      },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(r.resolution.kind, 'refused');
    assert.match((r.resolution as { reason: string }).reason, /AI classifier/);
  });

  it('reports an HTTP error with its status (grafana.com/about/careers/ is a 404)', async () => {
    const stub = io({
      pages: { 'https://grafana.com/robots.txt': { status: 404 }, 'https://grafana.com/about/careers/': { status: 404 } },
    });
    const r = await resolveCompanyUrl(paste('https://grafana.com/about/careers/'), stub);
    assert.equal(r.resolution.kind, 'refused');
    assert.match((r.resolution as { reason: string }).reason, /HTTP 404/);
  });

  it('reports a rate limit as itself, not as "no board here" (contentful answered 429)', async () => {
    const stub = io({
      pages: { 'https://acme.com/robots.txt': { status: 404 }, 'https://acme.com/careers': { status: 429 } },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(r.resolution.kind, 'refused');
    assert.match((r.resolution as { reason: string }).reason, /HTTP 429/);
  });

  it('reports a bot check separately from "nothing found"', async () => {
    const stub = io({
      pages: {
        'https://acme.com/robots.txt': { status: 404 },
        'https://acme.com/careers': { status: 200, body: '<title>Just a moment...</title>' },
      },
    });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(r.resolution.kind, 'refused');
    assert.match((r.resolution as { reason: string }).reason, /bot check/);
  });

  it('refuses while robots.txt itself is failing', async () => {
    const stub = io({ pages: { 'https://acme.com/robots.txt': { status: 503 } } });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.equal(r.resolution.kind, 'refused');
    assert.deepEqual(stub.asked, ['https://acme.com/robots.txt']);
  });

  it('says the site did not answer when the request failed outright', async () => {
    const stub = io({ pages: { 'https://acme.com/robots.txt': { status: 404 }, 'https://acme.com/careers': { status: 0 } } });
    const r = await resolveCompanyUrl(paste('https://acme.com/careers'), stub);
    assert.match((r.resolution as { reason: string }).reason, /did not answer/);
  });
});
