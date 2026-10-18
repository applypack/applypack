import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { firstIssue, flashRedirect, parseFlashCookie, refusedField, safeBack } from './flash';

/** A flash cookie as a browser sends it back — or as someone who edits cookies would write one. */
const cookieOf = (payload: unknown): string => `flash=${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;

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
  assert.equal(parseFlashCookie(`flash=${Buffer.from('{not-json').toString('base64url')}`), null);
  assert.equal(parseFlashCookie(cookieOf({ kind: 'loud', text: 'x' })), null);
});

test('safeBack keeps a redirect on this site', () => {
  assert.equal(safeBack('/jobs?status=NEW', '/'), '/jobs?status=NEW');
  assert.equal(safeBack('//evil.example', '/'), '/');
  assert.equal(safeBack('https://evil.example', '/'), '/');
  assert.equal(safeBack(undefined, '/runs'), '/runs');
});

test('safeBack reads the value as a browser would: every spelling of another host is refused', () => {
  // Found live (#354): `back=/\\evil.example/x` answered 303 with that Location, and a browser went there.
  const hostile = [
    '/\\evil.example/x',
    '/\\/evil.example',
    '/\\\\evil.example',
    '/.//evil.example',
    '/..//evil.example/x',
    '/jobs/..//evil.example',
    '/%2e//evil.example',
    '\\/evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    ' //evil.example',
  ];
  for (const back of hostile) {
    const kept = safeBack(back, '/');
    assert.equal(kept, '/', back);
    assert.equal(new URL(kept, 'http://127.0.0.1:4747').origin, 'http://127.0.0.1:4747', back);
  }
});

test('safeBack keeps what stays on the site, in the spelling a header takes', () => {
  assert.equal(safeBack('/companies#muted', '/'), '/companies#muted');
  assert.equal(safeBack('/jobs/7?tab=match&match=12#resume-match', '/'), '/jobs/7?tab=match&match=12#resume-match');
  // A backslash inside the path is a slash to a browser, and the path it makes is still ours.
  assert.equal(safeBack('/jobs\\7', '/'), '/jobs/7');
  assert.equal(safeBack('/@evil.example', '/'), '/@evil.example');
  // Not ASCII: `new Response` refused the header and the request answered 500.
  const encoded = safeBack('/jobs?q=програміст', '/');
  assert.equal(encoded, '/jobs?q=%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D1%96%D1%81%D1%82');
  assert.equal(flashRedirect(encoded, 'ok', 'Saved.').headers.get('location'), encoded);
});

test('safeBack refuses a control character, so a Location cannot be split', () => {
  assert.equal(safeBack('/jobs\r\nSet-Cookie: a=b', '/'), '/');
  assert.equal(safeBack('/jobs\nSet-Cookie: a=b', '/'), '/');
  assert.equal(safeBack('/jobs\u0085x', '/'), '/');
  assert.equal(safeBack('/jobs\u0000', '/'), '/');
  // A space and a percent-escape are ordinary path characters.
  assert.equal(safeBack('/jobs?q=a%20b', '/'), '/jobs?q=a%20b');
});

test('a download link rides the flash only when it is ours (TASKS R25)', () => {
  const cookie = (download: string) => {
    const res = flashRedirect('/resumes/3', 'ok', 'Saved as v4 (.docx patched).', { download });
    return parseFlashCookie((res.headers.get('set-cookie') ?? '').split(';')[0]!);
  };
  assert.equal(cookie('/resumes/3/download')?.download, '/resumes/3/download');
  assert.equal(cookie('https://evil.example/x')?.download, undefined, 'the cookie is the browser\'s to edit');
  assert.equal(cookie('/resumes/3/download?x=1')?.download, undefined);
});

test('the refused field rides the flash with its form, and only names do (TASKS U15)', () => {
  const at = '/settings/profiles/3/save';
  assert.deepEqual(refusedField(at, [{ path: ['stackRequired', 0] }]), { field: { form: at, name: 'stackRequired' } });
  assert.deepEqual(refusedField(at, [{ path: [] }]), {}, 'a root-level issue names no field');
  assert.deepEqual(refusedField(at, [{ path: [0] }]), {});
  assert.deepEqual(refusedField('/jobs?x="]', [{ path: ['name'] }]), {}, 'a form path only');
  const cookie = (field: unknown) => {
    return parseFlashCookie(cookieOf({ kind: 'err', text: 'name: required.', field }));
  };
  const res = flashRedirect('/settings?tab=profile', 'err', 'name: required.', refusedField(at, [{ path: ['name'] }]));
  assert.deepEqual(parseFlashCookie((res.headers.get('set-cookie') ?? '').split(';')[0]!)?.field, { form: at, name: 'name' });
  // The cookie is the browser's to edit, and both parts land in a selector on the page.
  assert.equal(cookie({ form: at, name: '"]; alert(1); ["' })?.field, undefined);
  assert.equal(cookie({ form: '/a"] b', name: 'name' })?.field, undefined);
  assert.equal(cookie('name')?.field, undefined);
});

// ADR 0061: a browser drops a cookie past 4 096 bytes silently, and the old percent-encoding
// spent six characters on a Cyrillic letter and nine on a Devanagari one.
test('a long message in Ukrainian or Hindi still fits the cookie, and comes back whole', () => {
  const COOKIE_LIMIT = 4096;
  for (const text of ['Резюме збережено як нову версію. '.repeat(24), 'रेज़्यूमे नए संस्करण के रूप में सहेजा गया। '.repeat(12)]) {
    const header = flashRedirect('/resumes/3', 'ok', text).headers.get('set-cookie') ?? '';
    assert.ok(header.length < COOKIE_LIMIT, `${header.length} bytes`);
    assert.ok(encodeURIComponent(JSON.stringify({ kind: 'ok', text })).length > COOKIE_LIMIT, 'percent-encoded, this message would have been dropped');
    assert.match(header.split(';')[0]!, /^flash=[A-Za-z0-9_-]+$/, 'only characters a cookie value may hold');
    assert.equal(parseFlashCookie(header.split(';')[0]!)?.text, text);
  }
});
