import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDashboardUrl, dashboardLink } from './dashboard-link';

test('the dashboard address is kept as a link can start with it (#487)', () => {
  assert.deepEqual(checkDashboardUrl(' http://127.0.0.1:4747/ '), { ok: true, url: 'http://127.0.0.1:4747' });
  // A proxy may serve the dashboard under a path; the path stays, the query and the fragment go.
  assert.deepEqual(checkDashboardUrl('https://home.example.com/applypack/?tab=1#x'), { ok: true, url: 'https://home.example.com/applypack' });
  assert.deepEqual(checkDashboardUrl('http://192.168.1.20:4747'), { ok: true, url: 'http://192.168.1.20:4747' });
});

test('an address typed without its scheme gets the http:// a browser would add (#549)', () => {
  assert.deepEqual(checkDashboardUrl('192.168.1.20:4993'), { ok: true, url: 'http://192.168.1.20:4993' });
  assert.deepEqual(checkDashboardUrl('applypack.local:4747/'), { ok: true, url: 'http://applypack.local:4747' });
  assert.deepEqual(checkDashboardUrl('localhost:4747'), { ok: true, url: 'http://localhost:4747' });
  assert.deepEqual(checkDashboardUrl('home.example.com/applypack'), { ok: true, url: 'http://home.example.com/applypack' });
});

test('an address a message must not carry is refused, with the reason', () => {
  assert.deepEqual(checkDashboardUrl('ftp://applypack.local/'), { ok: false, reason: 'The address starts with http:// or https://.' });
  assert.equal(checkDashboardUrl('not an address').ok, false);
  assert.equal(checkDashboardUrl('javascript:alert(1)').ok, false);
  // The link goes into a chat: the dashboard's Basic Auth password must not.
  const creds = checkDashboardUrl('https://me:secret@home.example.com');
  assert.equal(creds.ok, false);
  assert.match(creds.ok ? '' : creds.reason, /user name and password/);
});

test('a link into the dashboard exists only with an address, and only with a good one', () => {
  assert.equal(dashboardLink('https://home.example.com/ap', '/jobs/12?tab=pack'), 'https://home.example.com/ap/jobs/12?tab=pack');
  assert.equal(dashboardLink(null, '/jobs/12'), null);
  assert.equal(dashboardLink('', '/jobs/12'), null);
  // A row edited by hand is read as the form would have read it.
  assert.equal(dashboardLink('https://me:secret@home.example.com', '/jobs/12'), null);
  assert.equal(dashboardLink('http://127.0.0.1:4747/', '/jobs/12'), 'http://127.0.0.1:4747/jobs/12');
});
