import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AtsType } from '@prisma/client';
import { probeAts, robotsRefusal } from './ats-probe';

/**
 * A manually added feed or careers page fetches the user's own host, so
 * robots.txt binds it exactly as it binds the watchlist ladder. The read is
 * injected, so nothing here touches the network — and the two `probeAts`
 * cases are safe for the same reason: a refusal returns before the fetch.
 */
describe('robotsRefusal', () => {
  const answering = (body: string) => async () => ({ status: 200, body });

  it('refuses a path the site disallows', async () => {
    const reason = await robotsRefusal('https://example.com/careers', {
      aiTokens: [],
      fetchRobots: answering('User-agent: *\nDisallow: /\n'),
    });
    assert.match(reason ?? '', /robots\.txt/i);
  });

  it('allows a path the site permits', async () => {
    const reason = await robotsRefusal('https://example.com/careers', {
      aiTokens: [],
      fetchRobots: answering('User-agent: *\nAllow: /\nDisallow: /admin\n'),
    });
    assert.equal(reason, null);
  });

  it('asks the origin, once, whatever the path', async () => {
    const asked: string[] = [];
    await robotsRefusal('https://example.com/deep/path/jobs.rss', {
      aiTokens: [],
      fetchRobots: async (url) => {
        asked.push(url);
        return { status: 200, body: '' };
      },
    });
    assert.deepEqual(asked, ['https://example.com/robots.txt']);
  });

  it('obeys an AI-crawler group only when this install runs that engine', async () => {
    const body = 'User-agent: *\nAllow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n';
    assert.equal(
      await robotsRefusal('https://example.com/careers', { aiTokens: [], fetchRobots: answering(body) }),
      null,
    );
    assert.match(
      (await robotsRefusal('https://example.com/careers', {
        aiTokens: ['claudebot'],
        fetchRobots: answering(body),
      })) ?? '',
      /robots\.txt/i,
    );
  });
});

describe('probeAts — the two types that fetch the user’s own site', () => {
  const refusing = async () => ({ status: 200, body: 'User-agent: *\nDisallow: /\n' });

  for (const [type, token] of [
    [AtsType.FEED, 'https://example.com/jobs/feed'],
    [AtsType.CAREER_PAGE, 'https://example.com/careers'],
  ] as const) {
    it(`refuses a ${type} that robots.txt disallows, before fetching it`, async () => {
      const result = await probeAts(type, token, { fetchRobots: refusing, aiTokens: [] });
      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /robots\.txt/i);
    });
  }
});
