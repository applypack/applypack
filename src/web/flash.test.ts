import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { firstIssue, flashRedirect, parseFlashCookie, safeBack } from './flash';

test('firstIssue names the field and the reason', () => {
  const schema = z.object({ name: z.string().min(1, 'a name is required'), days: z.number() });
  const result = schema.safeParse({ name: '', days: 3 });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(firstIssue(result.error.issues), 'name: a name is required');
});

test('firstIssue joins a nested path and survives a root-level issue', () => {
  assert.equal(firstIssue([{ path: ['search', 'hours', 0], message: 'out of range' }]), 'search.hours.0: out of range');
  assert.equal(firstIssue([{ path: [], message: 'pick one source' }]), 'pick one source');
  assert.equal(firstIssue([]), 'the form arrived empty');
});

test('firstIssue cuts the value a schema echoes back, so the cookie stays a cookie', () => {
  const result = z.object({ checkEvery: z.enum(['hour', 'day', 'week']) }).safeParse({ checkEvery: 'x'.repeat(5_000) });
  assert.equal(result.success, false);
  if (!result.success) {
    const text = firstIssue(result.error.issues);
    assert.ok(text.startsWith('checkEvery: Invalid enum value'));
    assert.ok(text.length <= 161, `${text.length} characters`);
  }
});

test('a flash survives the redirect cookie and nothing else does', () => {
  const res = flashRedirect('/settings', 'err', 'Profile not saved; fix "name" and save again.');
  assert.equal(res.status, 303);
  const cookie = res.headers.get('Set-Cookie')?.split(';')[0];
  assert.deepEqual(parseFlashCookie(cookie), { kind: 'err', text: 'Profile not saved; fix "name" and save again.' });
  assert.equal(parseFlashCookie('flash=%7Bnot-json'), null);
  assert.equal(parseFlashCookie(`flash=${encodeURIComponent(JSON.stringify({ kind: 'loud', text: 'x' }))}`), null);
});

test('safeBack keeps a redirect on this site', () => {
  assert.equal(safeBack('/jobs?status=NEW', '/'), '/jobs?status=NEW');
  assert.equal(safeBack('//evil.example', '/'), '/');
  assert.equal(safeBack('https://evil.example', '/'), '/');
  assert.equal(safeBack(undefined, '/runs'), '/runs');
});

test('safeBack refuses a control character, so a Location cannot be split (D12h)', () => {
  assert.equal(safeBack('/jobs\r\nSet-Cookie: a=b', '/'), '/');
  assert.equal(safeBack('/jobs\nSet-Cookie: a=b', '/'), '/');
  assert.equal(safeBack('/jobs\u0085x', '/'), '/');
  assert.equal(safeBack('/jobs\u0000', '/'), '/');
  // A space and a percent-escape are ordinary path characters.
  assert.equal(safeBack('/jobs?q=a%20b', '/'), '/jobs?q=a%20b');
});
