import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardedMethod, sameOriginPost } from './same-origin';

const HOST = 'localhost:4747';

test('the dashboard posting to itself passes', () => {
  const v = sameOriginPost({ origin: `http://${HOST}`, secFetchSite: 'same-origin', host: HOST });
  assert.equal(v.ok, true);
});

test("a page on someone else's site cannot post here", () => {
  const v = sameOriginPost({ origin: 'https://evil.example', secFetchSite: 'cross-site', host: HOST });
  assert.equal(v.ok, false);
  assert.match(v.reason, /cross-site/);
});

test('a foreign Origin is refused even when the browser sends no Sec-Fetch-Site', () => {
  // Older browsers, and anything that strips the header at a proxy.
  const v = sameOriginPost({ origin: 'https://evil.example', host: HOST });
  assert.equal(v.ok, false);
  assert.match(v.reason, /evil\.example is not localhost:4747/);
});

test('curl passes — no Origin, no Sec-Fetch-Site, and the repo runs on scripts', () => {
  const v = sameOriginPost({ host: HOST });
  assert.equal(v.ok, true);
  assert.match(v.reason, /not a browser/);
});

test('a bookmarked or typed POST passes (Sec-Fetch-Site: none)', () => {
  assert.equal(sameOriginPost({ secFetchSite: 'none', host: HOST }).ok, true);
});

test('a sibling subdomain is not "us"', () => {
  const v = sameOriginPost({ origin: 'https://blog.example.com', secFetchSite: 'same-site', host: 'app.example.com' });
  assert.equal(v.ok, false);
});

test("an opaque Origin is refused when no browser vouches for it", () => {
  // What an attacker's sandboxed frame looks like on a browser too old to
  // send fetch metadata.
  const v = sameOriginPost({ origin: 'null', host: HOST });
  assert.equal(v.ok, false);
  assert.match(v.reason, /opaque Origin/);
});

test('an opaque Origin from someone else is still refused', () => {
  assert.equal(sameOriginPost({ origin: 'null', secFetchSite: 'cross-site', host: HOST }).ok, false);
});

test('a page in a sandboxed frame posting to ITSELF passes', () => {
  // Measured, not assumed: an embedded dashboard sends `Origin: null`
  // (the document's origin is opaque) with `Sec-Fetch-Site: same-origin`
  // (the browser's own comparison of the initiator against this URL). No
  // cross-site page can produce that pair, so the browser's word wins.
  const v = sameOriginPost({ origin: 'null', secFetchSite: 'same-origin', host: HOST });
  assert.equal(v.ok, true);
  assert.match(v.reason, /same-origin/);
});

test('the browser\'s word beats a mismatched Origin in both directions', () => {
  // cross-site with a host that happens to match is still cross-site…
  assert.equal(
    sameOriginPost({ origin: `http://${HOST}`, secFetchSite: 'cross-site', host: HOST }).ok,
    false,
  );
});

test('the port is part of the host — another service on the same machine is not us', () => {
  const v = sameOriginPost({ origin: 'http://localhost:3000', host: HOST });
  assert.equal(v.ok, false);
});

test('scheme is not compared, so a TLS-terminating proxy still works', () => {
  const v = sameOriginPost({ origin: 'https://jobs.example.com', host: 'jobs.example.com' });
  assert.equal(v.ok, true);
});

test('a garbled Origin is refused rather than parsed generously', () => {
  assert.equal(sameOriginPost({ origin: 'not a url', host: HOST }).ok, false);
});

test('only state-changing methods are guarded', () => {
  assert.equal(guardedMethod('GET'), false);
  assert.equal(guardedMethod('head'), false);
  assert.equal(guardedMethod('POST'), true);
  assert.equal(guardedMethod('delete'), true);
});
