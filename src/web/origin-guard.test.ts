import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { originGuard } from './origin-guard';

/*
 * These drive a real Hono app rather than calling the pure check, because the
 * bug this file exists for was in the wiring, not the decision: the check
 * learned to read `Referer` and `X-Forwarded-Host` while the middleware went
 * on passing three headers, and every unit test stayed green because they call
 * `sameOriginPost` directly. The testing shape came in with PR #87.
 */

function app(): Hono {
  const a = new Hono();
  a.use('*', originGuard());
  a.get('/t', (c) => c.text('get-ok'));
  a.post('/t', (c) => c.text('post-ok'));
  return a;
}

const HOST = '127.0.0.1:4747';
const post = async (headers: Record<string, string>): Promise<Response> =>
  app().request('/t', { method: 'POST', headers: { host: HOST, ...headers } });

describe('originGuard', () => {
  it('lets a same-origin form through', async () => {
    const res = await post({ origin: `http://${HOST}`, 'sec-fetch-site': 'same-origin' });
    assert.equal(res.status, 200);
  });

  it('refuses a cross-site POST', async () => {
    const res = await post({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /Cross-origin request refused/);
  });

  it('refuses a foreign Origin with no fetch metadata', async () => {
    assert.equal((await post({ origin: 'https://evil.example' })).status, 403);
  });

  it('reads the Referer — the header the middleware used to drop', async () => {
    assert.equal((await post({ referer: 'http://evil.example/attacker-form' })).status, 403);
    assert.equal((await post({ referer: `http://${HOST}/jobs/123` })).status, 200);
  });

  it('reads X-Forwarded-Host — the other header it used to drop', async () => {
    // A reverse proxy passing Host: localhost upstream must not make every
    // same-origin form on the public hostname look foreign.
    const res = await post({
      origin: 'https://jobs.example.com',
      'x-forwarded-host': 'jobs.example.com',
    });
    assert.equal(res.status, 200);
    // …and it still has to agree with the Origin.
    const bad = await post({ origin: 'https://evil.example', 'x-forwarded-host': 'jobs.example.com' });
    assert.equal(bad.status, 403);
  });

  it('lets a page in a sandboxed frame post to itself', async () => {
    const res = await post({ origin: 'null', 'sec-fetch-site': 'same-origin' });
    assert.equal(res.status, 200);
  });

  it('refuses an opaque Origin with nothing vouching for it', async () => {
    assert.equal((await post({ origin: 'null' })).status, 403);
  });

  it('lets a header-less client through — curl is not the attack', async () => {
    assert.equal((await post({})).status, 200);
  });

  it('never checks a GET', async () => {
    const res = await app().request('/t', {
      headers: { host: HOST, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(res.status, 200);
  });
});
