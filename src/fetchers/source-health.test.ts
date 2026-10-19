import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../http';
import {
  FETCH_STATUSES,
  QUIET_STREAK,
  advancesLastOk,
  SILENT_DAYS,
  classifyFetchCount,
  classifyFetchError,
  describeStatus,
  healthUpdate,
  isFailing,
  isFailureStatus,
  isSilent,
  nextStreak,
  quietReason,
  type FetchStatus,
  type SourceHealth,
} from './source-health';

/** The statuses that mean "the board answered", in FETCH_STATUSES order. */
const ANSWERS: ReadonlySet<FetchStatus> = new Set<FetchStatus>(['ok', 'empty', 'not_modified']);

const http = (status: number): HttpError =>
  new HttpError(`HTTP ${status} for https://x/y`, status, 'https://x/y');

/** undici's shape: TypeError('fetch failed') carrying the real reason. */
function fetchFailed(cause: { code?: string; message?: string }): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(cause.message ?? 'x'), cause) });
}

describe('classifyFetchError — measured vendor behaviour', () => {
  it('304 is the feed being unchanged, not a failure', () => {
    // fetchWithRetry throws on every non-2xx, so a conditional hit arrives
    // here as an HttpError and must not be read as one.
    assert.equal(classifyFetchError(http(304)), 'not_modified');
  });

  it('404 and 410 mean the slug is gone', () => {
    assert.equal(classifyFetchError(http(404)), 'slug_gone');
    assert.equal(classifyFetchError(http(410)), 'slug_gone');
  });

  it('401 and 403 mean the board is gated, not dead', () => {
    assert.equal(classifyFetchError(http(401)), 'auth');
    assert.equal(classifyFetchError(http(403)), 'auth');
  });

  it('429 is its own status — a rate limit must never read as a dead slug', () => {
    assert.equal(classifyFetchError(http(429)), 'rate_limit');
  });

  it('5xx is the vendor, not us', () => {
    assert.equal(classifyFetchError(http(500)), 'server');
    assert.equal(classifyFetchError(http(503)), 'server');
  });

  it('an unmapped 4xx falls to unknown, which still counts', () => {
    assert.equal(classifyFetchError(http(418)), 'unknown');
  });

  it('a refused redirect is a dead slug — how BambooHR presents one', () => {
    assert.equal(
      classifyFetchError(fetchFailed({ message: 'unexpected redirect' })),
      'slug_gone',
    );
  });

  it('transport codes are network', () => {
    assert.equal(classifyFetchError(fetchFailed({ code: 'ENOTFOUND' })), 'network');
    assert.equal(classifyFetchError(fetchFailed({ code: 'ECONNREFUSED' })), 'network');
    assert.equal(classifyFetchError(fetchFailed({ code: 'ETIMEDOUT' })), 'network');
  });

  it('a bare "fetch failed" with no cause code is still network', () => {
    assert.equal(classifyFetchError(new TypeError('fetch failed')), 'network');
  });

  it('reads a timeout from the message — fetchWithRetry drops the AbortError name', () => {
    const err = new Error('Request to https://x/y timed out after 10000ms');
    assert.equal(err.name, 'Error');
    assert.equal(classifyFetchError(err), 'network');
  });

  it('a schema mismatch is a bad payload, not a network problem', () => {
    assert.equal(
      classifyFetchError(new Error('Greenhouse schema invalid for "acme": ...')),
      'bad_payload',
    );
  });

  it('HTML served with a 200 dies in resp.json() as a SyntaxError', () => {
    assert.equal(classifyFetchError(new SyntaxError('Unexpected token <')), 'bad_payload');
  });

  it('never invents ok or empty — those come from the row count', () => {
    for (const err of [http(404), http(500), new Error('boom'), null, undefined]) {
      const status = classifyFetchError(err);
      assert.notEqual(status, 'ok');
      assert.notEqual(status, 'empty');
    }
  });

  it('anything unrecognised is unknown, never silently healthy', () => {
    assert.equal(classifyFetchError(new Error('who knows')), 'unknown');
    assert.equal(classifyFetchError('a string'), 'unknown');
    assert.equal(classifyFetchError(null), 'unknown');
  });
});

describe('classifyFetchCount', () => {
  it('splits on the raw pre-filter count', () => {
    assert.equal(classifyFetchCount(7), 'ok');
    assert.equal(classifyFetchCount(0), 'empty');
  });
});

describe('advancesLastOk — a 304 is only as good as what it repeats', () => {
  it('a full response with rows moves lastOkAt', () => {
    assert.equal(advancesLastOk('ok', null), true);
  });

  it('an unchanged feed that last carried rows moves it too', () => {
    assert.equal(advancesLastOk('not_modified', 40), true);
  });

  it('an unchanged EMPTY board does not — the Breezy case', () => {
    // Measured 2026-09-04: a stable ETag over `[]`. Treating that as healthy
    // would let a dead board pass the silence check forever (gotcha 13).
    assert.equal(advancesLastOk('not_modified', 0), false);
  });

  it('a 304 we have no full response for proves nothing', () => {
    assert.equal(advancesLastOk('not_modified', null), false);
  });

  it('never moves it for empty or for a failure', () => {
    for (const status of FETCH_STATUSES) {
      if (status === 'ok' || status === 'not_modified') continue;
      assert.equal(advancesLastOk(status, 99), false, status);
    }
  });
});

describe('nextStreak — the inversion', () => {
  it('ok, empty and not_modified reset', () => {
    assert.equal(nextStreak('ok', 9), 0);
    assert.equal(nextStreak('empty', 9), 0);
    // A 304 is the board answering, so it cannot count against the source.
    assert.equal(nextStreak('not_modified', 9), 0);
  });

  it('every other status increments', () => {
    for (const status of FETCH_STATUSES) {
      if (ANSWERS.has(status)) continue;
      assert.equal(nextStreak(status, 2), 3, `${status} must increment`);
    }
  });

  it('unknown increments — a new error kind cannot fall out of the streak', () => {
    assert.equal(nextStreak('unknown', 0), 1);
  });

  it('exactly three statuses are treated as healthy', () => {
    // The list is the guard: a status added later is a failure unless
    // somebody deliberately said otherwise here.
    const healthy = FETCH_STATUSES.filter((s) => nextStreak(s, 5) === 0);
    assert.deepEqual([...healthy], [...ANSWERS]);
  });

  it('a corrupt negative counter cannot make the streak go backwards', () => {
    assert.equal(nextStreak('server', -4), 1);
  });
});

describe('healthUpdate — what one attempt writes', () => {
  const at = new Date('2026-10-19T10:00:00Z');

  it('every attempt stamps when the source was read, an empty answer and a failure too (#547)', () => {
    // "Last fetch" read the newest stored posting, so a board read fine whose postings the filter turned away showed "—".
    for (const status of FETCH_STATUSES) assert.equal(healthUpdate(status, 0, null, at).lastFetchedAt, at, status);
  });

  it('moves lastOkAt only on an answer that proves the source still posts', () => {
    assert.equal(healthUpdate('ok', 0, null, at).lastOkAt, at);
    assert.equal(healthUpdate('not_modified', 0, 12, at).lastOkAt, at);
    assert.equal('lastOkAt' in healthUpdate('not_modified', 0, 0, at), false);
    assert.equal('lastOkAt' in healthUpdate('empty', 0, null, at), false);
    assert.equal('lastOkAt' in healthUpdate('network', 2, null, at), false);
  });

  it('carries the status and the streak', () => {
    assert.deepEqual(healthUpdate('network', 2, null, at), { lastFetchStatus: 'network', consecutiveFailures: 3, lastFetchedAt: at });
    assert.equal(healthUpdate('empty', 7, null, at).consecutiveFailures, 0);
  });
});

const NOW = new Date('2026-08-30T12:00:00Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const health = (over: Partial<SourceHealth> = {}): SourceHealth => ({
  lastFetchStatus: 'ok',
  consecutiveFailures: 0,
  lastOkAt: NOW,
  createdAt: daysAgo(400),
  ...over,
});

describe('isFailing', () => {
  it('trips exactly at the threshold', () => {
    assert.equal(isFailing(health({ consecutiveFailures: QUIET_STREAK - 1 })), false);
    assert.equal(isFailing(health({ consecutiveFailures: QUIET_STREAK })), true);
  });
});

describe('isSilent', () => {
  it('a source that keeps producing postings is not silent', () => {
    assert.equal(isSilent(health({ lastOkAt: daysAgo(1) }), NOW), false);
  });

  it('trips at SILENT_DAYS without a posting', () => {
    assert.equal(isSilent(health({ lastOkAt: daysAgo(SILENT_DAYS - 1) }), NOW), false);
    assert.equal(isSilent(health({ lastOkAt: daysAgo(SILENT_DAYS) }), NOW), true);
  });

  it('catches the SmartRecruiters case: reachable, 200, forever empty', () => {
    const sr = health({ lastFetchStatus: 'empty', lastOkAt: null, createdAt: daysAgo(60) });
    assert.equal(isFailing(sr), false);
    assert.equal(isSilent(sr, NOW), true);
  });

  it('a never-fetched source is unknown, not silent', () => {
    assert.equal(
      isSilent(health({ lastFetchStatus: null, lastOkAt: null, createdAt: daysAgo(90) }), NOW),
      false,
    );
  });

  it('a company added yesterday is not silent', () => {
    assert.equal(
      isSilent(health({ lastFetchStatus: 'empty', lastOkAt: null, createdAt: daysAgo(1) }), NOW),
      false,
    );
  });

  it('failing wins over silent — the louder signal is the specific one', () => {
    const both = health({ lastFetchStatus: 'slug_gone', consecutiveFailures: 5, lastOkAt: daysAgo(90) });
    assert.equal(isSilent(both, NOW), false);
    assert.equal(quietReason(both, NOW), 'failing');
  });
});

describe('quietReason', () => {
  it('is null for a healthy source', () => {
    assert.equal(quietReason(health(), NOW), null);
  });

  it('reports silence when the streak is clean', () => {
    assert.equal(quietReason(health({ lastOkAt: daysAgo(30) }), NOW), 'silent');
  });
});

describe('describeStatus', () => {
  it('labels every status in the vocabulary', () => {
    for (const status of FETCH_STATUSES) {
      const { label, tone } = describeStatus(status);
      assert.ok(label.length > 0, `${status} needs a label`);
      assert.notEqual(tone, 'none', `${status} must not fall through to the default`);
    }
  });

  it('falls back for a null or unseen status', () => {
    assert.equal(describeStatus(null).tone, 'none');
    assert.equal(describeStatus('something-new').tone, 'none');
  });

  it('never calls a rate limit a dead slug', () => {
    assert.notEqual(describeStatus('rate_limit').tone, describeStatus('slug_gone').tone);
  });

  it('speaks of a folder in a folder’s words, and of everything else as before', () => {
    assert.deepEqual(describeStatus('slug_gone', 'FOLDER'), { label: 'Folder not found', tone: 'bad' });
    assert.equal(describeStatus('auth', 'FOLDER').label, 'Not allowed to read');
    assert.equal(describeStatus('bad_payload', 'FOLDER').label, 'Files do not fit the mapping');
    assert.equal(describeStatus('empty', 'FOLDER').label, 'Nothing new');
    assert.equal(describeStatus('ok', 'FOLDER').label, 'OK');
    assert.equal(describeStatus(null, 'FOLDER').tone, 'none');
    assert.equal(describeStatus('slug_gone', 'GREENHOUSE').label, 'Slug not found');
  });
});

describe('classifyFetchError — a folder source', () => {
  const fault = (code: string): Error => Object.assign(new Error('folder'), { name: 'FolderError', fault: code });

  it('reads what went wrong with the folder into the statuses the health row already has', () => {
    assert.equal(classifyFetchError(fault('missing')), 'slug_gone');
    assert.equal(classifyFetchError(fault('not-a-folder')), 'slug_gone');
    assert.equal(classifyFetchError(fault('refused')), 'auth');
    assert.equal(classifyFetchError(fault('not-allowed')), 'auth');
    assert.equal(classifyFetchError(fault('unmapped')), 'bad_payload');
    // #405: a folder with more entries than a look lists is not "files that do not fit the mapping", and remapping does not help it.
    assert.equal(classifyFetchError(fault('too-many')), 'too_many');
    assert.equal(isFailureStatus('too_many'), true);
    assert.deepEqual(describeStatus('too_many', 'FOLDER'), { label: 'Too many entries in the folder', tone: 'bad' });
    // #397: a disk that stopped answering is a source that cannot be reached, and it counts toward the failure streak.
    assert.equal(classifyFetchError(fault('stalled')), 'network');
    assert.equal(classifyFetchError(fault('something-new')), 'unknown');
  });
});

describe('isFailureStatus', () => {
  it('treats only ok, empty and not_modified as answers', () => {
    for (const s of ANSWERS) assert.equal(isFailureStatus(s), false, s);
    for (const s of FETCH_STATUSES) {
      if (ANSWERS.has(s)) continue;
      assert.equal(isFailureStatus(s), true, s);
    }
  });
});

describe('isSilent — sources that never post', () => {
  const old = { lastFetchStatus: 'empty', consecutiveFailures: 0, lastOkAt: null, createdAt: new Date('2026-01-01T00:00:00Z') };
  const now = new Date('2026-06-01T00:00:00Z');

  it('ages an ordinary board that has produced nothing', () => {
    assert.equal(isSilent({ ...old, atsType: 'GREENHOUSE' }, now), true);
  });

  // A change watch returns [] on every successful read, so lastOkAt can never
  // advance. Without the exemption every one would read as silent forever.
  it('never ages a change watch, which produces no postings by design', () => {
    assert.equal(isSilent({ ...old, atsType: 'CAREER_PAGE' }, now), false);
    assert.equal(isSilent({ ...old, atsType: 'MANUAL' }, now), false);
    assert.equal(isSilent({ ...old, atsType: 'IMPORT' }, now), false);
    // A folder nothing new landed in is not a board that went quiet.
    assert.equal(isSilent({ ...old, atsType: 'FOLDER' }, now), false);
  });

  it('still reports one that is failing outright', () => {
    assert.equal(
      isFailing({ ...old, atsType: 'CAREER_PAGE', lastFetchStatus: 'slug_gone', consecutiveFailures: 3 }),
      true,
    );
  });

  it('an absent atsType behaves as before', () => {
    assert.equal(isSilent(old, now), true);
  });
});
