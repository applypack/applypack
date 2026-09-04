import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OUR_TOKEN, isAllowed, parseRobots, pathMatches, robotsAllows } from './robots';

const allowed = (txt: string, path: string) => isAllowed(parseRobots(txt), path).allowed;

describe('parseRobots — grouping (RFC 9309 §2.2.1)', () => {
  it('shares one rule set between consecutive user-agent lines', () => {
    const r = parseRobots('User-agent: a\nUser-agent: b\nDisallow: /x');
    assert.equal(r.groups.length, 1);
    assert.deepEqual(r.groups[0]?.agents, ['a', 'b']);
    assert.equal(r.groups[0]?.rules.length, 1);
  });

  it('starts a new group when a user-agent follows a rule', () => {
    const r = parseRobots('User-agent: a\nDisallow: /x\nUser-agent: b\nDisallow: /y');
    assert.equal(r.groups.length, 2);
    assert.deepEqual(r.groups[1]?.agents, ['b']);
  });

  it('ignores comments, blank lines, and fields it does not implement', () => {
    const r = parseRobots(
      '# hello\n\nSitemap: https://e.com/s.xml\nUser-agent: *  # everyone\nCrawl-delay: 5\nDisallow: /x # why\nHost: e.com',
    );
    assert.equal(r.groups.length, 1);
    assert.deepEqual(r.groups[0]?.rules, [{ allow: false, pattern: '/x' }]);
  });

  it('drops rules that appear before any user-agent line', () => {
    assert.deepEqual(parseRobots('Disallow: /x').groups, []);
  });

  it('reads an empty Disallow as no rule at all, so it forbids nothing', () => {
    assert.equal(allowed('User-agent: *\nDisallow:', '/anything'), true);
    assert.deepEqual(parseRobots('User-agent: *\nDisallow:').groups[0]?.rules, []);
  });

  it('is case-insensitive on field names and agent values', () => {
    assert.equal(allowed('USER-AGENT: ApplyPack\nDISALLOW: /careers', '/careers'), false);
  });
});

describe('pathMatches (RFC 9309 §2.2.3)', () => {
  it('is a prefix match', () => {
    assert.equal(pathMatches('/jobs', '/jobs/42'), true);
    assert.equal(pathMatches('/jobs', '/careers'), false);
  });

  it('expands * to any run of characters', () => {
    assert.equal(pathMatches('/*/jobs', '/eu/jobs'), true);
    assert.equal(pathMatches('/a*b', '/axxxb/c'), true);
    assert.equal(pathMatches('/a*b', '/axxx'), false);
  });

  it('anchors on $', () => {
    assert.equal(pathMatches('/jobs$', '/jobs'), true);
    assert.equal(pathMatches('/jobs$', '/jobs/42'), false);
    assert.equal(pathMatches('/*.php$', '/a/b.php'), true);
    assert.equal(pathMatches('/*.php$', '/a/b.php?x=1'), false);
  });

  it('treats regex metacharacters in a path as literals', () => {
    assert.equal(pathMatches('/a+b', '/a+b/c'), true);
    assert.equal(pathMatches('/a+b', '/aab'), false);
    assert.equal(pathMatches('/a.b', '/axb'), false);
  });
});

describe('isAllowed — longest match wins, ties to Allow (§2.2.2)', () => {
  const txt = 'User-agent: *\nDisallow: /api/\nAllow: /api/v2\nAllow: /api/v1';

  it('reproduces the 4dayweek.io case from ADR 0005', () => {
    assert.equal(allowed(txt, '/api/search'), false);
    assert.equal(allowed(txt, '/api/v2/jobs'), true);
    assert.equal(allowed(txt, '/api/v1/jobs'), true);
  });

  it('gives a tie to Allow', () => {
    assert.equal(allowed('User-agent: *\nDisallow: /x\nAllow: /x', '/x'), true);
  });

  it('allows everything a group says nothing about', () => {
    assert.equal(allowed('User-agent: *\nDisallow: /admin', '/careers'), true);
  });

  it('honours a total ban', () => {
    assert.equal(allowed('User-agent: *\nDisallow: /', '/careers'), false);
  });
});

describe('isAllowed — which groups bind us', () => {
  it('reads our own product token', () => {
    assert.equal(allowed(`User-agent: ${OUR_TOKEN}\nDisallow: /careers`, '/careers'), false);
  });

  it('falls back to * when we have no group of our own', () => {
    assert.equal(allowed('User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /careers', '/careers'), false);
  });

  it('ignores a group aimed at somebody else entirely', () => {
    assert.equal(allowed('User-agent: Googlebot\nDisallow: /careers', '/careers'), true);
  });

  // ADR 0005 addendum rule 2 — the reason this module is not a plain RFC reader.
  it('refuses a path an AI bot is banned from, whatever name we would ask under', () => {
    const nodesk = 'User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /';
    const verdict = isAllowed(parseRobots(nodesk), '/remote-jobs');
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.refusedBy, 'claudebot');
    assert.match(verdict.reason, /AI classifier/);
  });

  it('takes the strictest group even when ours allows the path', () => {
    const txt = `User-agent: ${OUR_TOKEN}\nAllow: /\n\nUser-agent: CCBot\nDisallow: /jobs`;
    assert.equal(allowed(txt, '/jobs/1'), false);
  });

  // The bug this pins: merging a named group with `*` let NoDesk's
  // "ClaudeBot: Disallow /" lose a length tie to "*: Allow /".
  it('lets a named group replace the wildcard rather than merge with it', () => {
    const txt = 'User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nAllow: /';
    assert.equal(allowed(txt, '/x'), false);
  });

  it('still refuses when only the wildcard forbids it — we have no exemption', () => {
    const txt = 'User-agent: ClaudeBot\nAllow: /\n\nUser-agent: *\nDisallow: /careers';
    assert.equal(allowed(txt, '/careers'), false);
  });

  it('says who refused, so the screen can quote it', () => {
    const v = isAllowed(parseRobots('User-agent: Google-Extended\nDisallow: /careers'), '/careers');
    assert.equal(v.refusedBy, 'google-extended');
  });

  // Measured on the fixture: all three name AI bots and allow them.
  it('lets through the three fixture hosts that name AI bots with Allow: /', () => {
    const netlify = 'User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: *\nAllow: /';
    assert.equal(allowed(netlify, '/careers/'), true);
    // Supabase names them with no rules at all, which RFC 9309 reads as allow-all.
    const supabase = 'User-agent: GPTBot\n\nUser-agent: ClaudeBot\n\nUser-agent: *\nDisallow: /dashboard';
    assert.equal(allowed(supabase, '/careers'), true);
  });
});

describe('robotsAllows — the HTTP answer', () => {
  it("treats a missing file as allow-all, which is the protocol's own answer", () => {
    for (const status of [404, 410, 403, 401, 400]) {
      assert.equal(robotsAllows(status, '', '/careers').allowed, true, String(status));
    }
  });

  it('refuses while the host is failing — a broken server has told us nothing', () => {
    for (const status of [500, 502, 503, 0]) {
      const v = robotsAllows(status, '', '/careers');
      assert.equal(v.allowed, false, String(status));
      assert.match(v.reason, /robots\.txt/);
    }
  });

  it('reads the rules on a 200', () => {
    assert.equal(robotsAllows(200, 'User-agent: *\nDisallow: /careers', '/careers').allowed, false);
    assert.equal(robotsAllows(200, 'User-agent: *\nDisallow: /admin', '/careers').allowed, true);
  });

  it('an empty 200 body forbids nothing', () => {
    assert.equal(robotsAllows(200, '', '/careers').allowed, true);
  });

  it('an HTML error page served as robots.txt forbids nothing rather than everything', () => {
    assert.equal(robotsAllows(200, '<!DOCTYPE html><h1>Not found</h1>', '/careers').allowed, true);
  });
});
