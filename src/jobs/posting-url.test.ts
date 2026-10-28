import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ashbyPostingText,
  checkPostingUrl,
  fetchPublicHops,
  isPrivateHost,
  isPrivateIp,
  parseAshbyUrl,
  pickAshbyJob,
  postingTextFromHtml,
  resolvesToPublic,
} from './posting-url';

test('checkPostingUrl refuses junk, wrong protocols and ADR 0005 hosts', () => {
  assert.equal(checkPostingUrl('not a url').ok, false);
  assert.equal(checkPostingUrl('ftp://example.com/job').ok, false);
  assert.equal(checkPostingUrl('https://www.linkedin.com/jobs/view/123').ok, false);
  assert.equal(checkPostingUrl('https://acme.myworkdayjobs.com/en-US/jobs/details/1').ok, false);
  assert.equal(checkPostingUrl('https://boards.greenhouse.io/acme/jobs/1').ok, true);
  // "notlinkedin.com" is a different host, not a subdomain of a blocked one.
  assert.equal(checkPostingUrl('https://notlinkedin.com/jobs/1').ok, true);
});

test('postingTextFromHtml strips markup and rejects thin or challenged pages', () => {
  const html = `<html><body><h1>Senior PHP Engineer</h1><p>${'We build Laravel systems. '.repeat(20)}</p></body></html>`;
  const ok = postingTextFromHtml(html);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.match(ok.text, /Senior PHP Engineer/);
    assert.doesNotMatch(ok.text, /<h1>/);
  }

  assert.equal(postingTextFromHtml('<html><body>tiny</body></html>').ok, false);
  const challenge = postingTextFromHtml(
    `<html><body>Just a moment... Checking your browser before accessing. ${'x'.repeat(400)}</body></html>`,
  );
  assert.equal(challenge.ok, false);
  if (!challenge.ok) assert.match(challenge.error, /bot check/);
});

test('a company page gives its posting, not its menus', () => {
  // Shaped like Vercel's own listing (live, 2026-10-28): a menu of products
  // in the header, the posting in <main>.
  const menu = `<header><nav><a>Products</a><a>AI SDK</a><a>AI Gateway</a><a>Sandbox</a></nav></header>`;
  const posting = `<main><h1>Software Engineer, Backend</h1><p>${'Build identity services in TypeScript. '.repeat(12)}</p></main>`;
  const r = postingTextFromHtml(`<html><body>${menu}${posting}<footer>Privacy · Legal</footer></body></html>`);
  assert.ok(r.ok);
  if (r.ok) {
    assert.match(r.text, /^Software Engineer, Backend/);
    assert.doesNotMatch(r.text, /AI Gateway|Privacy/);
  }
});

test('a posting read off its JobPosting block keeps its role and employer in the text', () => {
  const block = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Backend Engineer',
    hiringOrganization: { '@type': 'Organization', name: 'Acme' },
    description: `<p>${'You will run the billing services in Go. '.repeat(12)}</p>`,
  };
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(block)}</script></head><body><nav>Home · Jobs · Blog</nav><div>${'Cookie banner text. '.repeat(30)}</div></body></html>`;
  const r = postingTextFromHtml(html);
  assert.ok(r.ok);
  if (r.ok) {
    assert.match(r.text, /^Backend Engineer\n\nAcme\n\nYou will run the billing services in Go\./);
    assert.doesNotMatch(r.text, /Cookie banner/);
  }
});

test('a posting that merely names a bot-check vendor is a posting', () => {
  const html = `<html><body><h1>Senior Platform Engineer</h1><p>Our edge runs on
    Cloudflare Workers, and we use a captcha on the sign-up form.
    ${'We build Go services. '.repeat(20)}</p></body></html>`;
  const result = postingTextFromHtml(html);
  assert.equal(result.ok, true, 'a vendor name is not evidence of a challenge');
  if (result.ok) assert.match(result.text, /Cloudflare Workers/);
});

test('isPrivateHost covers loopback, RFC1918, link-local and IPv6', () => {
  for (const h of [
    'localhost', 'dev.localhost', 'printer.local', '127.0.0.1', '10.1.2.3',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '[::1]',
  ]) {
    assert.equal(isPrivateHost(h), true, `${h} must be private`);
  }
  for (const h of [
    'boards.greenhouse.io', '8.8.8.8', '172.32.0.1', '172.15.0.1',
    '192.169.0.1', '11.0.0.1', '2606:4700::1111',
  ]) {
    assert.equal(isPrivateHost(h), false, `${h} must be public`);
  }
});

test('checkPostingUrl refuses the private address space', () => {
  assert.equal(checkPostingUrl('http://localhost:4747/jobs/1').ok, false);
  assert.equal(checkPostingUrl('http://169.254.169.254/latest/meta-data/').ok, false);
  assert.equal(checkPostingUrl('http://192.168.0.10/careers').ok, false);
  assert.equal(checkPostingUrl('https://jobs.example.com/careers/1').ok, true);
});

test('an Ashby URL is a board and maybe a job id; anything else is a page (ADR 0043)', () => {
  assert.deepEqual(parseAshbyUrl(new URL('https://jobs.ashbyhq.com/sierra/9ebc3a79-82bf-478d-bd98-d473d41bdeaf')), { org: 'sierra', jobId: '9ebc3a79-82bf-478d-bd98-d473d41bdeaf' });
  assert.deepEqual(parseAshbyUrl(new URL('https://JOBS.ashbyhq.com/sierra/9EBC3A79-82BF-478D-BD98-D473D41BDEAF/application')), { org: 'sierra', jobId: '9EBC3A79-82BF-478D-BD98-D473D41BDEAF' });
  assert.deepEqual(parseAshbyUrl(new URL('https://jobs.ashbyhq.com/fieldguide')), { org: 'fieldguide', jobId: null });
  assert.deepEqual(parseAshbyUrl(new URL('https://jobs.ashbyhq.com/fieldguide/jobs?x=1')), { org: 'fieldguide', jobId: null }, 'a non-uuid second segment is still the board');
  assert.equal(parseAshbyUrl(new URL('https://jobs.ashbyhq.com/')), null);
  assert.equal(parseAshbyUrl(new URL('https://boards.greenhouse.io/acme/jobs/1')), null);
});

test('pickAshbyJob: the id wins, a board root needs exactly one role with the posting title', () => {
  const jobs = [
    { id: 'a', title: 'Engineering Manager, Core' },
    { id: 'b', title: 'Software Engineer' },
    { id: 'c', title: 'software engineer ' },
  ];
  assert.deepEqual(pickAshbyJob(jobs, { org: 'x', jobId: 'b' }, 'whatever'), { ok: true, job: jobs[1] });
  assert.match((pickAshbyJob(jobs, { org: 'x', jobId: 'zzz' }, 'whatever') as { error: string }).error, /no longer on the company's Ashby board/);
  assert.deepEqual(pickAshbyJob(jobs, { org: 'x', jobId: null }, 'engineering manager, core'), { ok: true, job: jobs[0] }, 'case and outer spaces do not matter');
  assert.match((pickAshbyJob(jobs, { org: 'x', jobId: null }, 'Software Engineer') as { error: string }).error, /lists 2 roles titled "Software Engineer" — paste the job page URL/);
  assert.match((pickAshbyJob(jobs, { org: 'x', jobId: null }, 'Designer') as { error: string }).error, /board's index \(3 roles\), not a job page/);
  assert.match((pickAshbyJob(jobs, { org: 'x', jobId: null }, undefined) as { error: string }).error, /board's index/);
});

test('ashbyPostingText reads like a page: title, place, then the body as text — and a thin body is refused', () => {
  const body = `<p>${'We build things. '.repeat(20)}</p><ul><li>Go</li><li>Kubernetes</li></ul>`;
  const r = ashbyPostingText({ title: 'Staff Engineer', location: 'Remote (US)', descriptionHtml: body });
  assert.ok(r.ok);
  assert.match(r.text, /^Staff Engineer\nRemote \(US\)\n\nWe build things\./);
  assert.match(r.text, /• Go\n• Kubernetes/);
  assert.equal(ashbyPostingText({ title: 'Staff Engineer', location: null, descriptionHtml: '<p>short</p>' }).ok, false);
});

test('isPrivateIp reads every spelling of a private address (audit 2026-09-10)', () => {
  for (const ip of [
    '127.0.0.1', '10.0.0.1', '169.254.169.254', '224.0.0.1', '::1', '::', 'fe80::1', 'fd12::1',
    '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe',
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} must be private`);
  }
  for (const ip of ['8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808', '172.32.0.1']) {
    assert.equal(isPrivateIp(ip), false, `${ip} must be public`);
  }
});

test('isPrivateIp decodes the IPv4 inside a transition address (6to4, compatible, NAT64)', () => {
  for (const ip of [
    '2002:7f00:1::', '2002:0a00:0001::', '2002:a9fe:a9fe::1', '2002:c0a8:101:5::1', '::127.0.0.1', '::7f00:1', '::a00:1',
    '0:0:0:0:0:ffff:7f00:1', '64:ff9b::10.0.0.1', '64:ff9b:1::808:808', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '2001:db8::1', '100::1', 'fec0::1', 'ff02::1', '[2002:7f00:1::]',
    '::ffff:0:7f00:1', '::ffff:0:127.0.0.1', '::ffff:0:a9fe:a9fe',
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} must be private`);
  }
  for (const ip of ['2002:808:808::1', '64:ff9b::8.8.8.8', '::ffff:0:808:808', '2a00:1450:4001:80b::200e', '2001:4860:4860::8888']) {
    assert.equal(isPrivateIp(ip), false, `${ip} must be public`);
  }
});

test('isPrivateHost: a trailing dot, a mapped literal, an intranet name — the three bypasses', () => {
  for (const h of ['localhost.', 'localhost..', 'intranet..', 'nas.lan..', '[::ffff:a9fe:a9fe]', '::ffff:169.254.169.254', 'intranet', 'db.internal', 'nas.lan', 'router.home.arpa']) {
    assert.equal(isPrivateHost(h), true, `${h} must be private`);
  }
  assert.equal(isPrivateHost('jobs.example.com.'), false);
});

test('checkPostingUrl refuses the literal bypasses and a URL carrying credentials', () => {
  assert.equal(checkPostingUrl('http://localhost./x').ok, false);
  assert.equal(checkPostingUrl('http://localhost../x').ok, false);
  assert.equal(checkPostingUrl('http://[::ffff:0:7f00:1]/').ok, false);
  assert.equal(checkPostingUrl('http://[::ffff:169.254.169.254]/').ok, false);
  assert.equal(checkPostingUrl('http://intranet/x').ok, false);
  assert.equal(checkPostingUrl('http://user:pass@example.com/x').ok, false);
  assert.equal(checkPostingUrl('http://2130706433/').ok, false);
  assert.equal(checkPostingUrl('http://[2002:7f00:1::]/secret').ok, false);
  // The name still has to resolve somewhere public — that is layer 2, not this one.
  assert.equal(checkPostingUrl('http://127.0.0.1.nip.io/').ok, true);
});

test('resolvesToPublic refuses a name whose records point inside, and a name with none', async () => {
  const resolving = (map: Record<string, string[]>) => async (h: string) => {
    const a = map[h];
    if (!a) throw new Error('ENOTFOUND');
    return a;
  };
  const dnsMap = resolving({
    'jobs.example.com': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
    '127.0.0.1.nip.io': ['127.0.0.1'],
    'mixed.example.com': ['93.184.216.34', '10.0.0.1'],
  });
  assert.deepEqual(await resolvesToPublic(new URL('https://jobs.example.com/1'), dnsMap), { ok: true });
  assert.equal((await resolvesToPublic(new URL('http://127.0.0.1.nip.io/'), dnsMap)).ok, false);
  assert.equal((await resolvesToPublic(new URL('http://mixed.example.com/'), dnsMap)).ok, false, 'one private record is enough');
  assert.equal((await resolvesToPublic(new URL('http://nope.example.com/'), dnsMap)).ok, false);
  // A literal was judged by checkPostingUrl already; nothing to resolve.
  assert.deepEqual(await resolvesToPublic(new URL('http://8.8.8.8/'), dnsMap), { ok: true });
});

test('fetchPublicHops guards every redirect hop before it is requested', async () => {
  const dnsMap = async (h: string) => (h === 'evil.example' ? ['169.254.169.254'] : ['93.184.216.34']);
  const requested: string[] = [];
  const chain: Record<string, { status: number; location: string | null }> = {
    'https://a.example/1': { status: 302, location: '/2' },
    'https://a.example/2': { status: 301, location: 'https://b.example/3' },
    'https://b.example/3': { status: 200, location: null },
    'https://a.example/meta': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
    'https://a.example/evil': { status: 302, location: 'http://evil.example/' },
    'https://a.example/loop': { status: 302, location: '/loop' },
  };
  const fetchOnce = async (url: string) => {
    requested.push(url);
    return chain[url] ?? { status: 404, location: null };
  };

  const ok = await fetchPublicHops('https://a.example/1', fetchOnce, dnsMap);
  assert.deepEqual(ok, { ok: true, response: { status: 200, location: null }, url: 'https://b.example/3' });

  requested.length = 0;
  const meta = await fetchPublicHops('https://a.example/meta', fetchOnce, dnsMap);
  assert.equal(meta.ok, false);
  assert.deepEqual(requested, ['https://a.example/meta'], 'the private hop is never requested');

  requested.length = 0;
  const evil = await fetchPublicHops('https://a.example/evil', fetchOnce, dnsMap);
  assert.equal(evil.ok, false);
  assert.deepEqual(requested, ['https://a.example/evil'], 'a public name resolving inside is never requested either');

  const loop = await fetchPublicHops('https://a.example/loop', fetchOnce, dnsMap);
  assert.equal(loop.ok, false);
  if (!loop.ok) assert.match(loop.error, /too many times/);

  assert.equal((await fetchPublicHops('http://localhost./x', fetchOnce, dnsMap)).ok, false);
});
