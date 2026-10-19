import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginConditionalTick,
  cachedCount,
  commitConditionalCache,
  conditionalHeaders,
  rememberResponse,
  resetConditionalCache,
  tickStoredEverything,
  hydrateConditionalCache,
  judgeUnder,
  needsHydration,
  readValidator,
} from './conditional';

/** What we send instead of the `no-cache` Node would add. */
const CC = 'max-age=0';

const URL_A = 'https://boards-api.greenhouse.io/v1/boards/gusto/jobs?content=true';
const URL_B = 'https://jobicy.com/?feed=job_feed&geo=poland';

/** Just enough of a Response for the cache: the two validator headers. */
function response(headers: Record<string, string>): { headers: { get(name: string): string | null } } {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null } };
}

/** One source's tick: fetch, parse, remember, then the tick commits. */
function fullTick(companyId: number, url: string, headers: Record<string, string>, count: number): void {
  beginConditionalTick();
  rememberResponse(companyId, url, response(headers), count);
  commitConditionalCache();
}

beforeEach(() => {
  resetConditionalCache();
});

describe('conditionalHeaders', () => {
  it('sends nothing before the first response', () => {
    assert.deepEqual(conditionalHeaders(1, URL_A), {});
  });

  it('sends back whichever validators the vendor gave', () => {
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    assert.deepEqual(conditionalHeaders(1, URL_A), { 'If-None-Match': 'W/"abc"', 'Cache-Control': CC });

    fullTick(2, URL_A, { 'last-modified': 'Thu, 03 Sep 2026 11:09:17 GMT' }, 12);
    assert.deepEqual(conditionalHeaders(2, URL_A), {
      'If-Modified-Since': 'Thu, 03 Sep 2026 11:09:17 GMT',
      'Cache-Control': CC,
    });

    fullTick(3, URL_A, { etag: 'W/"x"', 'last-modified': 'Thu, 03 Sep 2026 11:09:17 GMT' }, 3);
    assert.deepEqual(conditionalHeaders(3, URL_A), {
      'If-None-Match': 'W/"x"',
      'If-Modified-Since': 'Thu, 03 Sep 2026 11:09:17 GMT',
      'Cache-Control': CC,
    });
  });

  it('overrides the Cache-Control Node would otherwise send', () => {
    // Node appends `Cache-Control: no-cache` to a conditional request, and
    // Express answers 200 to that — measured on Lever and SmartRecruiters.
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    assert.equal(conditionalHeaders(1, URL_A)['Cache-Control'], 'max-age=0');
  });

  it('sends no Cache-Control when there is nothing to revalidate', () => {
    assert.equal(conditionalHeaders(9, URL_A)['Cache-Control'], undefined);
  });

  it('stays a no-op for a vendor that sends no validator', () => {
    // RemoteOK, Working Nomads, JobTech… — nothing to remember, nothing to send.
    fullTick(1, URL_A, {}, 200);
    assert.deepEqual(conditionalHeaders(1, URL_A), {});
  });

  it('does not reuse a validator across a changed URL', () => {
    // The geo-filtered sources build their URL from the running searches; an
    // ETag from last week's countries must not be sent for this week's.
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    assert.deepEqual(conditionalHeaders(1, URL_B), {});
  });

  it('keeps sources apart', () => {
    fullTick(1, URL_A, { etag: 'W/"one"' }, 1);
    fullTick(2, URL_A, { etag: 'W/"two"' }, 1);
    assert.deepEqual(conditionalHeaders(1, URL_A), { 'If-None-Match': 'W/"one"', 'Cache-Control': CC });
    assert.deepEqual(conditionalHeaders(2, URL_A), { 'If-None-Match': 'W/"two"', 'Cache-Control': CC });
  });
});

describe('the commit rule — a validator is only sent once its jobs are stored', () => {
  it('a tick that never commits leaves the cache alone', () => {
    // Pausing mid-tick discards everything fetched; committing anyway would
    // answer 304 next tick over postings nobody stored.
    beginConditionalTick();
    rememberResponse(1, URL_A, response({ etag: 'W/"never-stored"' }), 40);
    // …no commitConditionalCache() — the pass aborted.
    assert.deepEqual(conditionalHeaders(1, URL_A), {});
    assert.equal(cachedCount(1), null);
  });

  it('drops what an aborted tick staged instead of committing it later', () => {
    beginConditionalTick();
    rememberResponse(1, URL_A, response({ etag: 'W/"aborted"' }), 40);

    // The next tick refetches in full and stores its jobs.
    beginConditionalTick();
    rememberResponse(2, URL_B, response({ etag: 'W/"stored"' }), 7);
    commitConditionalCache();

    assert.deepEqual(conditionalHeaders(1, URL_A), {}, 'the aborted entry never went live');
    assert.deepEqual(conditionalHeaders(2, URL_B), { 'If-None-Match': 'W/"stored"', 'Cache-Control': CC });
  });

  it('a committed entry survives later ticks that stage nothing', () => {
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    beginConditionalTick();
    commitConditionalCache();
    assert.deepEqual(conditionalHeaders(1, URL_A), { 'If-None-Match': 'W/"abc"', 'Cache-Control': CC });
  });
});

describe('cachedCount — what a 304 repeats', () => {
  it('is null until a full response has been stored', () => {
    assert.equal(cachedCount(1), null);
  });

  it('remembers the rows the last full response carried', () => {
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    assert.equal(cachedCount(1), 40);
  });

  it('remembers a zero — the unchanged-but-empty board', () => {
    fullTick(1, URL_A, { etag: 'W/"empty"' }, 0);
    assert.equal(cachedCount(1), 0);
  });

  it('follows the newest full response', () => {
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    fullTick(1, URL_A, { etag: 'W/"def"' }, 41);
    assert.equal(cachedCount(1), 41);
    assert.deepEqual(conditionalHeaders(1, URL_A), { 'If-None-Match': 'W/"def"', 'Cache-Control': CC });
  });
});

describe('tickStoredEverything — the rule that keeps a posting from vanishing', () => {
  const clean = { abortedMidRun: 0, skippedBlankProfile: 0, classifyFailed: 0 };

  it('lets a tick that stored everything promote its validators', () => {
    assert.equal(tickStoredEverything(clean), true);
  });

  it('refuses after a pause aborted the pass', () => {
    assert.equal(tickStoredEverything({ ...clean, abortedMidRun: 1 }), false);
  });

  it('refuses when no usable search existed, so nothing was persisted', () => {
    assert.equal(tickStoredEverything({ ...clean, skippedBlankProfile: 1 }), false);
  });

  it('refuses when a posting was fetched but never got a verdict', () => {
    // The AI chain ran dry mid-tick: those postings were dropped, and a
    // committed ETag would hide them until the feed changed.
    assert.equal(tickStoredEverything({ ...clean, classifyFailed: 1 }), false);
  });
});

/**
 * #558, found in the live check of 2026-10-18: a search broadened, Fetch now
 * a minute later, and Remotive answered 304 — the postings the old filter had
 * turned away stayed unseen until the feed itself changed.
 */
describe('the rules a validator was learned under (#558)', () => {
  const BEFORE = 'rules-before-the-edit';
  const AFTER = 'rules-after-the-edit';

  it('is sent while the rules hold, and not once they change', () => {
    judgeUnder(BEFORE);
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    assert.equal(conditionalHeaders(1, URL_A)['If-None-Match'], 'W/"abc"');
    judgeUnder(AFTER);
    assert.deepEqual(conditionalHeaders(1, URL_A), {});
  });

  it('holds again once the full read under the new rules is stored', () => {
    judgeUnder(BEFORE);
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    judgeUnder(AFTER);
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    assert.equal(conditionalHeaders(1, URL_A)['If-None-Match'], 'W/"abc"');
    // And a return to the old rules is a change of its own.
    judgeUnder(BEFORE);
    assert.deepEqual(conditionalHeaders(1, URL_A), {});
  });

  it('rides on the row, so the other process sees the same rule', () => {
    judgeUnder(BEFORE);
    rememberResponse(5, URL_B, response({ etag: '"v"' }), 9);
    const kept = commitConditionalCache().get(5);
    assert.equal(readValidator({ ...kept })?.rules, BEFORE);
    resetConditionalCache();
    judgeUnder(AFTER);
    hydrateConditionalCache([{ id: 5, validator: { ...kept } }]);
    assert.deepEqual(conditionalHeaders(5, URL_B), {});
  });

  it('reads a row kept before the rules were recorded in full, once', () => {
    judgeUnder(AFTER);
    hydrateConditionalCache([{ id: 6, validator: { url: URL_B, etag: '"old"', lastModified: null, count: 3 } }]);
    assert.deepEqual(conditionalHeaders(6, URL_B), {});
  });
});

describe('the validators the rows kept (TASKS S31)', () => {
  it('become the live ones once per process; a row without one is skipped', () => {
    resetConditionalCache();
    assert.equal(needsHydration(), true);
    const taken = hydrateConditionalCache([
      { id: 1, validator: { url: 'https://a.example/feed', etag: '"v1"', lastModified: null, count: 12 } },
      { id: 2, validator: null },
      { id: 3, validator: { url: 'https://c.example', etag: null, lastModified: null, count: 3 } },
      { id: 4, validator: 'nonsense' },
    ]);
    assert.equal(taken, 1);
    assert.equal(needsHydration(), false);
    assert.equal(conditionalHeaders(1, 'https://a.example/feed')['If-None-Match'], '"v1"');
    assert.equal(cachedCount(1), 12);
    assert.deepEqual(conditionalHeaders(3, 'https://c.example'), {});
    assert.equal(readValidator({ url: 'u', etag: 'e', lastModified: null, count: -1 })?.count, 0);
    resetConditionalCache();
  });

  it('a commit hands back what it promoted, for the rows', () => {
    resetConditionalCache();
    rememberResponse(9, 'https://b.example', response({ etag: '"x"' }), 4);
    const promoted = commitConditionalCache();
    assert.deepEqual([...promoted.keys()], [9]);
    assert.equal(promoted.get(9)?.count, 4);
    resetConditionalCache();
  });
});
