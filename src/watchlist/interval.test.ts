import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_POLICIES,
  CHECK_INTERVALS,
  PACING_TOLERANCE_MS,
  alertsEveryPosting,
  dueCutoff,
  intervalLabel,
  isDue,
  nextCheckAfter,
  starred,
  toAlertPolicy,
  toCheckInterval,
  watchRules,
} from './interval';

const NOW = new Date('2026-09-04T12:00:00Z');

describe('toCheckInterval', () => {
  it('keeps the three presets', () => {
    for (const v of CHECK_INTERVALS) assert.equal(toCheckInterval(v), v);
  });

  it('reads anything unrecognised as hourly, so a bad value cannot silence a company', () => {
    for (const v of ['', 'fortnight', 'HOUR', null, undefined]) {
      assert.equal(toCheckInterval(v), 'hour');
    }
  });
});

describe('toAlertPolicy', () => {
  it('keeps the two policies', () => {
    for (const v of ALERT_POLICIES) assert.equal(toAlertPolicy(v), v);
  });

  it('falls back to the normal pipeline, never to "alert on everything"', () => {
    for (const v of ['', 'everything', 'ALL', null, undefined]) {
      assert.equal(toAlertPolicy(v), 'matches');
    }
  });
});

describe('isDue', () => {
  it('treats NULL as due — a fresh row and a "Check now" both mean now', () => {
    assert.equal(isDue({ checkEvery: 'week', nextCheckAt: null }, NOW), true);
  });

  it('is due at the instant it comes due, not a millisecond later', () => {
    assert.equal(isDue({ checkEvery: 'hour', nextCheckAt: NOW }, NOW), true);
  });

  it('is not due while the interval has not elapsed', () => {
    const soon = new Date(NOW.getTime() + 30 * 60 * 1000);
    assert.equal(isDue({ checkEvery: 'hour', nextCheckAt: soon }, NOW), false);
  });

  it('is due when the row fell behind', () => {
    const past = new Date(NOW.getTime() - 9 * 24 * 60 * 60 * 1000);
    assert.equal(isDue({ checkEvery: 'week', nextCheckAt: past }, NOW), true);
  });

  it('allows the slack, so a row stamped a hair late is still read this tick', () => {
    const hair = new Date(NOW.getTime() + PACING_TOLERANCE_MS - 1);
    assert.equal(isDue({ checkEvery: 'hour', nextCheckAt: hair }, NOW), true);
    const beyond = new Date(NOW.getTime() + PACING_TOLERANCE_MS + 1);
    assert.equal(isDue({ checkEvery: 'hour', nextCheckAt: beyond }, NOW), false);
  });

  it('reads the same rule the walk\'s where clause reads', () => {
    const cutoff = dueCutoff(NOW);
    assert.equal(isDue({ checkEvery: 'hour', nextCheckAt: cutoff }, NOW), true);
    assert.equal(cutoff.getTime() - NOW.getTime(), PACING_TOLERANCE_MS);
  });
});

/**
 * The defect this pins, measured on the live install 2026-09-15…18: hourly
 * rows were read every OTHER tick. `nextCheckAt` was stamped an interval
 * after the attempt FINISHED, the next heartbeat started a moment earlier
 * than that, and the row missed its own slot every single time.
 */
describe('pacing over a day of heartbeats', () => {
  /** One hourly cron, `ticks` times, jitter included. Returns how often the row was read. */
  function readsOverTicks(checkEvery: string, ticks: number, stampFrom: 'tick' | 'attempt'): number {
    const HOUR = 60 * 60 * 1000;
    let nextCheckAt: Date | null = null;
    let reads = 0;
    for (let i = 0; i < ticks; i++) {
      // A cron fires on its minute, never on the same millisecond twice.
      const tick = new Date(NOW.getTime() + i * HOUR + (i % 2 === 0 ? 700 : 100));
      if (!isDue({ checkEvery, nextCheckAt }, tick)) continue;
      reads++;
      // The walk takes a while: sources, polite delays, a slow board.
      const attemptEnded = new Date(tick.getTime() + 95_000);
      nextCheckAt = nextCheckAfter({ checkEvery }, stampFrom === 'tick' ? tick : attemptEnded);
    }
    return reads;
  }

  it('reads an hourly row on every heartbeat', () => {
    assert.equal(readsOverTicks('hour', 24, 'tick'), 24);
  });

  it('holds even if the stamp is taken at the end of a long walk', () => {
    assert.equal(readsOverTicks('hour', 24, 'attempt'), 24);
  });

  it('reads a daily row once a day, not once every 25 hours', () => {
    assert.equal(readsOverTicks('day', 48, 'tick'), 2);
  });

  it('reads a weekly row once a week', () => {
    assert.equal(readsOverTicks('week', 24 * 14, 'tick'), 2);
  });
});

describe('nextCheckAfter', () => {
  it('counts from the attempt, not from the row it fell behind on', () => {
    assert.equal(
      nextCheckAfter({ checkEvery: 'hour' }, NOW).toISOString(),
      '2026-09-04T13:00:00.000Z',
    );
    assert.equal(
      nextCheckAfter({ checkEvery: 'day' }, NOW).toISOString(),
      '2026-09-05T12:00:00.000Z',
    );
    assert.equal(
      nextCheckAfter({ checkEvery: 'week' }, NOW).toISOString(),
      '2026-09-11T12:00:00.000Z',
    );
  });

  it('gives an unknown interval the hourly cadence', () => {
    assert.equal(
      nextCheckAfter({ checkEvery: 'whenever' }, NOW).toISOString(),
      '2026-09-04T13:00:00.000Z',
    );
  });

  it('never returns a time in the past, so a row cannot busy-loop', () => {
    for (const every of CHECK_INTERVALS) {
      assert.ok(nextCheckAfter({ checkEvery: every }, NOW).getTime() > NOW.getTime());
    }
  });
});

describe('watchRules', () => {
  it('reads the two columns and nothing else', () => {
    assert.deepEqual(watchRules({ watched: true, alertPolicy: 'all' }), {
      watched: true,
      alertPolicy: 'all',
    });
  });

  it('alertsEveryPosting is false for an unwatched row and for "matches"', () => {
    assert.equal(alertsEveryPosting(undefined), false);
    assert.equal(alertsEveryPosting({ watched: false, alertPolicy: 'matches' }), false);
    assert.equal(alertsEveryPosting({ watched: true, alertPolicy: 'matches' }), false);
    assert.equal(alertsEveryPosting({ watched: true, alertPolicy: 'all' }), true);
  });

  it('a policy of "all" on an unwatched row still bypasses — the column decides, not the star', () => {
    assert.equal(alertsEveryPosting({ watched: false, alertPolicy: 'all' }), true);
  });
});

describe('starred', () => {
  it('marks a watched company and leaves every other name alone', () => {
    assert.equal(starred('Acme', { watched: true, alertPolicy: 'all' }), '★ Acme');
    assert.equal(starred('Acme', { watched: false, alertPolicy: 'all' }), 'Acme');
    assert.equal(starred('Acme', undefined), 'Acme');
  });
});

describe('intervalLabel', () => {
  it('names each preset in the user\'s words', () => {
    assert.equal(intervalLabel('hour'), 'Every hour');
    assert.equal(intervalLabel('day'), 'Once a day');
    assert.equal(intervalLabel('week'), 'Once a week');
    assert.equal(intervalLabel('nonsense'), 'Every hour');
  });
});
