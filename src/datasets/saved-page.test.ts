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
  it('takes the posting’s own url and the browser’s saved-from note before the canonical link and og:url', () => {
    const canonical = '<link rel="canonical" href="https://jobs.example/acme/123?ref=a&amp;b=1">';
    const og = '<meta property="og:url" content="https://og.example/123">';
    const saved = '<!-- saved from url=(0031)https://saved.example/job/123 -->';
    const own = block({ '@type': 'JobPosting', url: 'https://block.example/1' });
    const at = (html: string): [string | null, boolean] => {
      const got = readSavedPage(html, NOW);
      return [got.address, got.addressIsOwn];
    };
    assert.deepEqual(at(page({ head: canonical + og + own })), ['https://block.example/1', true]);
    assert.deepEqual(at(`${saved}\n${page({ head: canonical })}`), ['https://saved.example/job/123', true]);
    // A canonical link or og:url may be a careers page every posting on it shares: kept as the link, not as the posting's own.
    assert.deepEqual(at(page({ head: canonical + og })), ['https://jobs.example/acme/123?ref=a&b=1', false]);
    assert.deepEqual(at(page({ head: og })), ['https://og.example/123', false]);
  });

  it('keeps no address that is not http(s)', () => {
    const got = readSavedPage(page({ head: '<link rel="canonical" href="javascript:alert(1)"><meta property="og:url" content="file:///etc/passwd">' }), NOW);
    assert.equal(got.address, null);
  });
});

describe('readSavedPage: a page that carries several postings', () => {
  const posting = (title: string, url?: string): Record<string, unknown> => ({ '@type': 'JobPosting', title, hiringOrganization: 'Acme', description: `${title}. ${BODY}`, ...(url && { url }) });
  const savedFrom = (url: string): string => `<!-- saved from url=(${String(url.length).padStart(4, '0')})${url} -->`;
  const main = posting('Staff Backend Engineer', 'https://acme.example/jobs/42');
  const similar = posting('QA Engineer', 'https://acme.example/jobs/7');

  it('reads the one the page is about, wherever its "similar jobs" stand', () => {
    for (const blocks of [block(similar) + block(main), block(main) + block(similar), block({ '@graph': [similar, main] })]) {
      const got = readSavedPage(`${savedFrom('https://acme.example/jobs/42?utm_source=mail')}${page({ head: blocks })}`, NOW);
      assert.equal(got.facts?.title, 'Staff Backend Engineer', blocks.slice(0, 60));
      assert.deepEqual([got.address, got.addressIsOwn], ['https://acme.example/jobs/42', true]);
      assert.match(got.text, /^Staff Backend Engineer\./);
    }
    // The canonical link and og:url say which page this is where the browser left no note.
    assert.equal(readSavedPage(page({ head: `<link rel="canonical" href="https://acme.example/jobs/42">${block(similar)}${block(main)}` }), NOW).facts?.title, 'Staff Backend Engineer');
    assert.equal(readSavedPage(page({ head: `<meta property="og:url" content="https://acme.example/jobs/7">${block(main)}${block(similar)}` }), NOW).facts?.title, 'QA Engineer');
  });

  it('reads no posting off a list of them: the first on a page of results is somebody else’s job', () => {
    const list = { '@type': 'ItemList', itemListElement: [main, similar].map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })) };
    const got = readSavedPage(`${savedFrom('https://acme.example/search?q=engineer')}${page({ head: block(list) })}`, NOW);
    assert.equal(got.facts, null);
    // The page it was saved from stays as a link, and names no posting.
    assert.deepEqual([got.address, got.addressIsOwn], ['https://acme.example/search?q=engineer', false]);
    assert.equal(got.text.includes('Own the billing service'), true);
    // With nothing saying which page this is, several postings are a list too.
    assert.equal(readSavedPage(page({ head: block(main) + block(similar) }), NOW).facts, null);
    // Two that name the page's address are not told apart by it.
    const twins = [posting('Data Engineer', 'https://acme.example/careers'), posting('Platform Engineer', 'https://acme.example/careers')];
    assert.equal(readSavedPage(page({ head: `<link rel="canonical" href="https://acme.example/careers">${twins.map(block).join('')}` }), NOW).facts, null);
  });

  it('takes one posting written twice as one', () => {
    const got = readSavedPage(page({ head: block(main) + block({ '@graph': [main] }) }), NOW);
    assert.equal(got.facts?.title, 'Staff Backend Engineer');
    assert.equal(got.addressIsOwn, true);
  });
});

describe('readSavedPage: what an earlier version keyed the job by', () => {
  const savedFrom = '<!-- saved from url=(0041)https://acme.example/jobs/42?utm_source=x -->';
  const posting = (more: Record<string, unknown> = {}): Record<string, unknown> => ({ '@type': 'JobPosting', title: 'Staff Backend Engineer', description: BODY, ...more });

  it('is the first block’s url as written, else the browser’s note, else the text', () => {
    assert.equal(readSavedPage(`${savedFrom}${page({ head: block(posting({ url: 'https://acme.example/jobs/42?ref=a' })) })}`, NOW).earlierKey, 'https://acme.example/jobs/42?ref=a');
    assert.equal(readSavedPage(`${savedFrom}${page({ head: block(posting()) })}`, NOW).earlierKey, 'https://acme.example/jobs/42?utm_source=x');
    assert.equal(readSavedPage(page({ head: `<link rel="canonical" href="https://acme.example/careers">${block(posting())}` }), NOW).earlierKey, BODY);
    assert.equal(readSavedPage(page(), NOW).earlierKey, readSavedPage(page(), NOW).text);
  });

  it('is the first posting’s, even where the page is about another', () => {
    const similar = { '@type': 'JobPosting', title: 'QA Engineer', description: `QA. ${BODY}`, url: 'https://acme.example/jobs/7' };
    const about = posting({ url: 'https://acme.example/jobs/42' });
    const got = readSavedPage(`${savedFrom}${page({ head: block(similar) + block(about) })}`, NOW);
    assert.equal(got.facts?.title, 'Staff Backend Engineer');
    assert.equal(got.earlierKey, 'https://acme.example/jobs/7');
    // A list with no address of its own was keyed by its first posting's text.
    const { url: _, ...unaddressed } = similar;
    const list = readSavedPage(page({ head: block(unaddressed) + block(posting()) }), NOW);
    assert.equal(list.facts, null);
    assert.equal(list.earlierKey, `QA. ${BODY}`);
  });
});

describe('readSavedPage on what a page should not be able to do', () => {
  it('never keeps markup, a script or a NUL in the text', () => {
    const got = readSavedPage(page({ body: `<main><script>steal()</script><style>p{}</style><p>${BODY}\u0000</p><img src=x onerror=alert(1)></main>` }), NOW);
    assert.doesNotMatch(got.text, /steal|onerror|<|\u0000/);
  });

  it('stays quick on a page of unclosed scripts and a huge head', () => {
    for (const hostile of [
      `${'<script type="application/ld+json">'.repeat(5_000)}${'<link rel=x '.repeat(20_000)}`,
      '<link'.repeat(60_000),
      '<meta'.repeat(60_000),
      `<title${'<title'.repeat(50_000)}`,
    ]) {
      const started = performance.now();
      readSavedPage(hostile, NOW);
      assert.ok(performance.now() - started < 1_000, hostile.slice(0, 12));
    }
  });

  it('drops a control character an entity spells', () => {
    const got = readSavedPage(page({ head: block({ '@type': 'JobPosting', title: 'Dev&#7;eloper', hiringOrganization: 'Ac&#1;me' }) }), NOW);
    assert.deepEqual([got.facts?.title, got.facts?.company], ['Developer', 'Acme']);
  });

  it('reads a block nested past the depth it walks as no block at all', () => {
    let deep: unknown = { '@type': 'JobPosting', title: 'Deep' };
    for (let i = 0; i < 10; i++) deep = { mainEntity: deep };
    assert.equal(readSavedPage(page({ head: block(deep as Record<string, unknown>) }), NOW).facts, null);
  });
});
