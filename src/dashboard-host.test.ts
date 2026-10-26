import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowedHostNames, hostAllowed, loopbackBind } from './dashboard-host';

describe('hostAllowed', () => {
  const none: string[] = [];

  it('answers this machine under its own names and any address', () => {
    for (const host of ['127.0.0.1:4747', 'localhost:4747', 'localhost', 'LOCALHOST.:4747', '[::1]:4747', 'app.localhost:4747', '192.168.1.20:4747', '[fd00::5]']) {
      assert.equal(hostAllowed(host, none), true, host);
    }
  });

  it('refuses a name nobody listed — what a rebinding page arrives as', () => {
    for (const host of ['attacker.example:4861', 'attacker.example', 'localhost.attacker.example', '127.0.0.1.nip.io:4747', 'evil-localhost:4747']) {
      assert.equal(hostAllowed(host, none), false, host);
    }
  });

  it('answers a listed name, and a leading dot covers its subdomains', () => {
    const allowed = allowedHostNames('jobs.example.com, .tail1234.ts.net', '127.0.0.1');
    assert.equal(hostAllowed('jobs.example.com', allowed), true);
    assert.equal(hostAllowed('JOBS.example.com.:443', allowed), true);
    assert.equal(hostAllowed('laptop.tail1234.ts.net:4747', allowed), true);
    assert.equal(hostAllowed('tail1234.ts.net', allowed), true);
    assert.equal(hostAllowed('other.example.com', allowed), false);
    assert.equal(hostAllowed('eviltail1234.ts.net', allowed), false);
  });

  it('answers the name the dashboard is bound to', () => {
    assert.equal(hostAllowed('myhost.lan:4747', allowedHostNames('', 'myhost.lan')), true);
    assert.deepEqual(allowedHostNames('', '0.0.0.0'), []);
    assert.deepEqual(allowedHostNames(' , ', '::'), []);
  });

  it('lets a request with no Host through: not a browser', () => {
    assert.equal(hostAllowed(undefined, none), true);
    assert.equal(hostAllowed('', none), true);
  });
});

describe('loopbackBind', () => {
  it('knows the loopback spellings', () => {
    for (const bind of ['127.0.0.1', '127.0.0.2', 'localhost', '::1', '[::1]']) assert.equal(loopbackBind(bind), true, bind);
  });

  it('takes anything else for a bind the network reaches', () => {
    for (const bind of ['0.0.0.0', '::', '192.168.1.20', 'myhost.lan', '']) assert.equal(loopbackBind(bind), false, bind);
  });
});
