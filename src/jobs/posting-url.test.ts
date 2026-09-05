import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ashbyPostingText, checkPostingUrl, isPrivateHost, parseAshbyUrl, pickAshbyJob, postingTextFromHtml } from './posting-url';

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
