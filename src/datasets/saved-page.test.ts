import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readSavedPage } from './saved-page';

const NOW = new Date(Date.UTC(2026, 9, 6, 12));
const BODY = 'Own the billing service end to end. '.repeat(12).trim();

const block = (posting: Record<string, unknown>): string => `<script type="application/ld+json">${JSON.stringify(posting)}</script>`;

const page = ({ head = '', body = `<p>${BODY}</p>` }: { head?: string; body?: string } = {}): string =>
  `<!DOCTYPE html><html><head><title>Senior Backend Engineer – Acme Careers</title>${head}</head><body><nav>Home · Jobs · Sign in</nav>${body}<footer>© Acme</footer></body></html>`;

describe('readSavedPage: the posting block', () => {
  it('reads the facts a JobPosting block states, and its description as the text', () => {
    const got = readSavedPage(
      page({
        head: block({
          '@context': 'https://schema.org',
          '@type': 'JobPosting',
          title: 'Senior Backend Engineer',
          hiringOrganization: { '@type': 'Organization', name: 'Acme GmbH' },
          jobLocation: { '@type': 'Place', address: { addressLocality: 'Berlin', addressCountry: 'DE' } },
          datePosted: '2026-10-01',
          description: `&lt;p&gt;${BODY}&lt;/p&gt;`,
        }),
      }),
      NOW,
    );
    assert.equal(got.facts?.title, 'Senior Backend Engineer');
    assert.equal(got.facts?.company, 'Acme GmbH');
    assert.equal(got.facts?.location, 'Berlin, DE');
    assert.equal(got.facts?.postedAt?.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(got.text, BODY);
  });

  it('finds the posting inside a list or a @graph, and reads a remote one as remote', () => {
    const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': ['JobPosting'], title: 'Data Engineer', jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'Poland' } }] };
    const got = readSavedPage(page({ head: block(graph) }), NOW);
    assert.equal(got.facts?.title, 'Data Engineer');
    assert.equal(got.facts?.workplace, 'REMOTE');
    assert.equal(got.facts?.location, 'Remote, Poland');
    assert.equal(got.facts?.company, null);
  });

  it('reads the page’s own text when the block’s description is a teaser, and skips a block that is not JSON', () => {
    const got = readSavedPage(page({ head: `<script type="application/ld+json">{ not json</script>${block({ '@type': 'JobPosting', title: 'QA', description: 'Short.' })}`, body: `<main><h1>QA</h1><p>${BODY}</p></main>` }), NOW);
    assert.equal(got.facts?.title, 'QA');
    assert.match(got.text, /^QA\n/);
    assert.doesNotMatch(got.text, /Sign in|© Acme/);
  });

  it('says there is no block when the page carries none, and keeps the whole text', () => {
    const got = readSavedPage(page(), NOW);
    assert.equal(got.facts, null);
    assert.match(got.text, /Own the billing service/);
    assert.equal(got.pageTitle, 'Senior Backend Engineer – Acme Careers');
  });
});

describe('readSavedPage: the page’s address', () => {
  it('takes the canonical link first, then og:url, then the posting’s url, then the browser’s saved-from note', () => {
    const canonical = '<link rel="canonical" href="https://jobs.example/acme/123?ref=a&amp;b=1">';
    const og = '<meta property="og:url" content="https://og.example/123">';
    const saved = '<!-- saved from url=(0031)https://saved.example/job/123 -->';
    assert.equal(readSavedPage(page({ head: canonical + og }), NOW).address, 'https://jobs.example/acme/123?ref=a&b=1');
    assert.equal(readSavedPage(page({ head: og }), NOW).address, 'https://og.example/123');
    assert.equal(readSavedPage(page({ head: block({ '@type': 'JobPosting', url: 'https://block.example/1' }) }), NOW).address, 'https://block.example/1');
    assert.equal(readSavedPage(`${saved}\n${page()}`, NOW).address, 'https://saved.example/job/123');
  });

  it('keeps no address that is not http(s)', () => {
    const got = readSavedPage(page({ head: '<link rel="canonical" href="javascript:alert(1)"><meta property="og:url" content="file:///etc/passwd">' }), NOW);
    assert.equal(got.address, null);
  });
});

describe('readSavedPage on what a page should not be able to do', () => {
  it('never keeps markup, a script or a NUL in the text', () => {
    const got = readSavedPage(page({ body: `<main><script>steal()</script><style>p{}</style><p>${BODY}\u0000</p><img src=x onerror=alert(1)></main>` }), NOW);
    assert.doesNotMatch(got.text, /steal|onerror|<|\u0000/);
  });

  it('stays quick on a page of unclosed scripts and a huge head', () => {
    const hostile = `${'<script type="application/ld+json">'.repeat(5_000)}${'<link rel=x '.repeat(20_000)}`;
    const started = performance.now();
    readSavedPage(hostile, NOW);
    assert.ok(performance.now() - started < 2_000);
  });

  it('reads a block nested past the depth it walks as no block at all', () => {
    let deep: unknown = { '@type': 'JobPosting', title: 'Deep' };
    for (let i = 0; i < 10; i++) deep = { mainEntity: deep };
    assert.equal(readSavedPage(page({ head: block(deep as Record<string, unknown>) }), NOW).facts, null);
  });
});
