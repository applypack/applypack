import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKED_POSTING_HOSTS, isBlockedPostingHost } from './blocked-hosts';

test('isBlockedPostingHost: every listed host and its subdomains, whatever the case', () => {
  for (const host of BLOCKED_POSTING_HOSTS) {
    assert.equal(isBlockedPostingHost(host), true);
    assert.equal(isBlockedPostingHost(`WWW.${host.toUpperCase()}`), true);
    assert.equal(isBlockedPostingHost(`jobs.eu.${host}`), true);
    // The fully qualified spelling resolves to the same host.
    assert.equal(isBlockedPostingHost(`${host}.`), true);
    assert.equal(isBlockedPostingHost(`www.${host}.`), true);
  }
});

test('isBlockedPostingHost: a host that only ends in the same letters is another host', () => {
  assert.equal(isBlockedPostingHost(`not${BLOCKED_POSTING_HOSTS[0]}`), false);
  assert.equal(isBlockedPostingHost('boards.example.org'), false);
  assert.equal(isBlockedPostingHost(''), false);
});

test('isBlockedPostingHost: a named site under a country domain or another name of its own', () => {
  for (const host of [
    'www.indeed.co.uk', 'indeed.de', 'au.indeed.com.au', 'www.glassdoor.co.uk', 'www.glassdoor.de', 'glassdoor.co.in',
    'linkedin.cn', 'br.linkedin.com.br', 'lnkd.in', 'angel.co', 'wd3.myworkdaysite.com', 'wd5.myworkday.com', 'www.indeed.co.uk.',
  ]) {
    assert.equal(isBlockedPostingHost(host), true, host);
  }
  for (const host of ['indeed.example-shop.com', 'notindeed.de', 'glassdoorcleaning.co.uk', 'indeedjobs.com', 'angel.com', 'linkedin-tips.example.org']) {
    assert.equal(isBlockedPostingHost(host), false, host);
  }
});
