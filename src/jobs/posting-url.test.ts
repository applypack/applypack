import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPostingUrl, postingTextFromHtml } from './posting-url';

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
