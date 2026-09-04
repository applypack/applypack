import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardHints,
  declaredJobFeeds,
  isJobFeedPath,
  looksLikeChallenge,
  urlsIn,
  wellKnownFeeds,
} from './scan';

/*
 * The snippets below are lifted verbatim from the pages recorded on
 * 2026-09-04 (docs/company-watchlist.md) — the escaping is theirs, not a
 * convenience for the test.
 */

describe('boardHints', () => {
  it('finds a board behind a plain anchor (netlify.com/careers)', () => {
    const html = '<a href="https://job-boards.greenhouse.io/netlify/jobs/4224129002">Open role</a>';
    assert.deepEqual(boardHints(html).map((h) => `${h.atsType}:${h.atsToken}`), ['GREENHOUSE:netlify']);
  });

  it('finds a board inside an entity-escaped JSON island (sentry.io/careers)', () => {
    const html =
      '{&quot;url&quot;:[0,&quot;https://jobs.ashbyhq.com/sentry/01f4db4e-cdba&quot;],&quot;departmentName&quot;:[0,&quot;Engineering&quot;]}';
    assert.deepEqual(boardHints(html).map((h) => h.atsToken), ['sentry']);
  });

  it('unescapes JSON slashes before reading, so a hydration payload counts', () => {
    const html = '{"board":"https:\\/\\/jobs.ashbyhq.com\\/supabase\\/06752423"}';
    assert.deepEqual(boardHints(html).map((h) => `${h.atsType}:${h.atsToken}`), ['ASHBY:supabase']);
  });

  it('reports each board once however many postings link to it', () => {
    const html = Array.from({ length: 20 }, (_, i) => `https://jobs.ashbyhq.com/Linear/job-${i}`).join(' ');
    assert.equal(boardHints(html).length, 1);
  });

  it('ignores a greenhouse URL that is not a board (vercel.com/careers)', () => {
    const html = '<a href="http://app4.greenhouse.io/ai_opt_out_request/job_post/5039945004/ai_opt_out">opt out</a>';
    assert.deepEqual(boardHints(html), []);
  });

  it('finds nothing on a page that links no board', () => {
    assert.deepEqual(boardHints('<h1>Careers</h1><p>Email us.</p>'), []);
  });
});

describe('urlsIn', () => {
  it('stops at the quote, the bracket and the tag', () => {
    assert.deepEqual(urlsIn('<a href="https://a.com/x">(https://b.com/y)</a>'), [
      'https://a.com/x',
      'https://b.com/y',
    ]);
  });
});

describe('isJobFeedPath — the whole defence against blog feeds', () => {
  it('accepts a path that names jobs', () => {
    for (const p of ['/jobs.rss', '/jobs/feed', '/careers/feed/', '/jobs.atom', '/en/careers/rss', '/vacancies.xml', '/jobs-feed.rss', '/positions/feed.xml']) {
      assert.equal(isJobFeedPath(p), true, p);
    }
  });

  it('rejects the blog feeds the fixture found', () => {
    // posthog.com declares /rss.xml (253 blog posts); netlify.com declares /feed.xml.
    for (const p of ['/rss.xml', '/feed.xml', '/feed', '/feed/', '/blog/feed', '/changelog/feed.xml', '/knowledge-base/feed.xml']) {
      assert.equal(isJobFeedPath(p), false, p);
    }
  });
});

describe('declaredJobFeeds', () => {
  const page = 'https://www.netlify.com/careers/';

  it('ignores every alternate whose path does not name jobs', () => {
    const html =
      '<link rel="alternate" type="application/rss+xml" href="/feed.xml" title="Netlify Blog">' +
      '<link rel="alternate" type="application/rss+xml" title="Netlify Changelog" href="https://www.netlify.com/changelog/feed.xml">';
    assert.deepEqual(declaredJobFeeds(html, page), []);
  });

  it('takes one whose path does, resolved against the page', () => {
    const html = '<link rel="alternate" type="application/rss+xml" href="/jobs.rss">';
    assert.deepEqual(declaredJobFeeds(html, page), ['https://www.netlify.com/jobs.rss']);
  });

  it('ignores an alternate that is not a feed type at all', () => {
    const html = '<link rel="alternate" hreflang="de" href="/de/jobs.rss">';
    assert.deepEqual(declaredJobFeeds(html, page), []);
  });

  it('survives an unparseable href', () => {
    assert.deepEqual(declaredJobFeeds('<link rel="alternate" type="application/rss+xml" href="::">', page), []);
  });
});

describe('wellKnownFeeds', () => {
  it('is three job-shaped paths on the page own origin, and never /feed', () => {
    const urls = wellKnownFeeds('https://acme.com/en/careers?x=1');
    assert.deepEqual(urls, ['https://acme.com/jobs.rss', 'https://acme.com/jobs/feed', 'https://acme.com/careers/feed']);
  });
});

describe('looksLikeChallenge', () => {
  it('matches the interstitial wording', () => {
    assert.equal(looksLikeChallenge('<title>Just a moment...</title>'), true);
    assert.equal(looksLikeChallenge('<h1>Checking your browser before accessing</h1>'), true);
    assert.equal(looksLikeChallenge('Please enable JavaScript and cookies to continue'), true);
  });

  // Measured 2026-09-04: posting-url.ts refuses cloudflare.com/careers because
  // it matches the bare vendor name. A company named after its CDN is not a
  // bot check.
  it('does not fire on a company that is named after the vendor protecting it', () => {
    assert.equal(looksLikeChallenge('<title>Careers | Cloudflare</title><p>Help build a better Internet</p>'), false);
  });

  // Both measured live: the bare word "captcha" hid inside markup on two of
  // the twenty, and reported a working careers page as a bot check.
  it('does not fire on a captcha mentioned in a style block (jobs.ashbyhq.com)', () => {
    assert.equal(
      looksLikeChallenge('<html><head><style>.grecaptcha-badge { visibility: hidden; }</style></head><body>Open roles</body></html>'),
      false,
    );
  });

  it('does not fire on a captcha mentioned in a comment (storyblok.com)', () => {
    assert.equal(
      looksLikeChallenge('<head><!-- ReCaptcha --><link href="https://www.google.com" rel="preconnect"></head><body>Careers</body>'),
      false,
    );
  });

  it('does fire on wording an interstitial actually shows a reader', () => {
    assert.equal(looksLikeChallenge('<h1>Please complete the captcha to continue</h1>'), true);
    assert.equal(looksLikeChallenge('<p>DDoS protection by Cloudflare</p>'), true);
  });

  it('does not scan the whole document for the phrase', () => {
    assert.equal(looksLikeChallenge(`<p>${'x '.repeat(3_000)}</p><p>just a moment</p>`), false);
  });
});
