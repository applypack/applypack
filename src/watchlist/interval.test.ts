import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_POLICIES,
  CHECK_INTERVALS,
  alertsEveryPosting,
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
    const soon = new Date(NOW.getTime() + 1);
    assert.equal(isDue({ checkEvery: 'hour', nextCheckAt: soon }, NOW), false);
  });

  it('is due when the row fell behind', () => {
    const past = new Date(NOW.getTime() - 9 * 24 * 60 * 60 * 1000);
    assert.equal(isDue({ checkEvery: 'week', nextCheckAt: past }, NOW), true);
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
