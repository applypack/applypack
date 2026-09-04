import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginConditionalTick,
  cachedCount,
  commitConditionalCache,
  conditionalHeaders,
  rememberResponse,
  resetConditionalCache,
} from './conditional';

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
    assert.deepEqual(conditionalHeaders(1, URL_A), { 'If-None-Match': 'W/"abc"' });

    fullTick(2, URL_A, { 'last-modified': 'Thu, 03 Sep 2026 11:09:17 GMT' }, 12);
    assert.deepEqual(conditionalHeaders(2, URL_A), {
      'If-Modified-Since': 'Thu, 03 Sep 2026 11:09:17 GMT',
    });

    fullTick(3, URL_A, { etag: 'W/"x"', 'last-modified': 'Thu, 03 Sep 2026 11:09:17 GMT' }, 3);
    assert.deepEqual(conditionalHeaders(3, URL_A), {
      'If-None-Match': 'W/"x"',
      'If-Modified-Since': 'Thu, 03 Sep 2026 11:09:17 GMT',
    });
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
    assert.deepEqual(conditionalHeaders(1, URL_A), { 'If-None-Match': 'W/"one"' });
    assert.deepEqual(conditionalHeaders(2, URL_A), { 'If-None-Match': 'W/"two"' });
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
    assert.deepEqual(conditionalHeaders(2, URL_B), { 'If-None-Match': 'W/"stored"' });
  });

  it('a committed entry survives later ticks that stage nothing', () => {
    fullTick(1, URL_A, { etag: 'W/"abc"' }, 40);
    beginConditionalTick();
    commitConditionalCache();
    assert.deepEqual(conditionalHeaders(1, URL_A), { 'If-None-Match': 'W/"abc"' });
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
    assert.deepEqual(conditionalHeaders(1, URL_A), { 'If-None-Match': 'W/"def"' });
  });
});
