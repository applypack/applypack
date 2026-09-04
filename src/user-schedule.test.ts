import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAlertNow,
  defaultSchedule,
  describeDays,
  describeNextFetch,
  describeSchedule,
  inHours,
  isDigestHour,
  isFetchDue,
  isTimezone,
  lastRealFetch,
  nextFetchAt,
  parseSchedule,
  shouldDeliverHeld,
  tickAfter,
  zonedParts,
  type Schedule,
} from './user-schedule';

const KYIV = 'Europe/Kyiv';

function schedule(over: Partial<Schedule> = {}): Schedule {
  return { ...defaultSchedule(KYIV), ...over };
}

function office(over: Partial<Schedule['fetch']> = {}): Schedule {
  return schedule({ fetch: { every: 'hour', from: 7, to: 23, days: [1, 2, 3, 4, 5], ...over } });
}

describe('defaults', () => {
  it('are exactly today\'s behaviour, so a fresh install notices nothing', () => {
    const s = defaultSchedule(KYIV);
    assert.deepEqual(s.fetch, { every: 'hour', from: 0, to: 23, days: [1, 2, 3, 4, 5, 6, 7] });
    assert.equal(s.alerts.mode, 'instant');
    assert.deepEqual(s.alerts.digestAt, [9], 'the digest cron has always run at 09:00');
    // Every hour of a week is due, and every one of them may alert.
    for (let i = 0; i < 24 * 7; i++) {
      const at = new Date(Date.UTC(2026, 8, 1, i));
      assert.equal(isFetchDue(at, s, null), true);
      assert.equal(canAlertNow(at, s), true);
    }
  });

  it('falls back whole when the stored JSON is unusable', () => {
    assert.deepEqual(parseSchedule(null, KYIV), defaultSchedule(KYIV));
    assert.deepEqual(parseSchedule({ timezone: 'Mars/Olympus' }, KYIV), defaultSchedule(KYIV));
    assert.deepEqual(parseSchedule({ ...defaultSchedule(KYIV), fetch: { every: 'week', from: 0, to: 23, days: [1] } }, KYIV), defaultSchedule(KYIV));
  });

  it('rejects an unknown zone and keeps a real one', () => {
    assert.equal(isTimezone(KYIV), true);
    assert.equal(isTimezone('Mars/Olympus'), false);
    assert.equal(defaultSchedule('Mars/Olympus').timezone, 'UTC');
  });

  it('normalises days and digest hours: deduped and sorted', () => {
    const raw = { ...defaultSchedule(KYIV), alerts: { mode: 'digest', from: 8, to: 22, days: [5, 1, 1], digestAt: [19, 9, 9] } };
    const parsed = parseSchedule(raw, KYIV);
    assert.deepEqual(parsed.alerts.days, [1, 5]);
    assert.deepEqual(parsed.alerts.digestAt, [9, 19]);
  });
});

describe('zonedParts', () => {
  it('reads the hour in the schedule\'s zone, not the server\'s', () => {
    // 2026-09-01 is a Tuesday. Kyiv is UTC+3 in September.
    assert.deepEqual(zonedParts(new Date('2026-09-01T05:30:00Z'), KYIV), { weekday: 2, hour: 8 });
    assert.deepEqual(zonedParts(new Date('2026-09-01T05:30:00Z'), 'UTC'), { weekday: 2, hour: 5 });
  });

  it('follows DST rather than a fixed offset', () => {
    // Kyiv leaves summer time at 04:00 local on the last Sunday of October 2026 (the 25th).
    assert.equal(zonedParts(new Date('2026-10-25T00:30:00Z'), KYIV).hour, 3, 'still UTC+3');
    assert.equal(zonedParts(new Date('2026-10-25T02:30:00Z'), KYIV).hour, 4, 'now UTC+2');
  });

  it('gives midnight as 0, never 24', () => {
    assert.equal(zonedParts(new Date('2026-09-01T21:00:00Z'), KYIV).hour, 0);
  });
});

describe('window edges', () => {
  it('includes both ends of the hour range', () => {
    assert.equal(inHours(7, 7, 23), true);
    assert.equal(inHours(23, 7, 23), true);
    assert.equal(inHours(6, 7, 23), false);
    assert.equal(inHours(0, 7, 23), false);
  });

  it('reads a window that crosses midnight as one stretch', () => {
    assert.equal(inHours(23, 22, 6), true);
    assert.equal(inHours(3, 22, 6), true);
    assert.equal(inHours(12, 22, 6), false);
  });
});

describe('isFetchDue', () => {
  const s = office();

  it('runs inside the window and sleeps outside it', () => {
    // 06:59 Kyiv = 03:59 UTC on a Tuesday.
    assert.equal(isFetchDue(new Date('2026-09-01T03:05:00Z'), s, null), false, '06:05 is before 07:00');
    assert.equal(isFetchDue(new Date('2026-09-01T04:05:00Z'), s, null), true, '07:05 is the first hour');
    assert.equal(isFetchDue(new Date('2026-09-01T20:05:00Z'), s, null), true, '23:05 is still the last hour');
    assert.equal(isFetchDue(new Date('2026-09-01T21:05:00Z'), s, null), false, 'midnight is out');
  });

  it('sleeps on a day the user did not pick, and wakes on Monday', () => {
    // 2026-09-05 is a Saturday, 2026-09-07 a Monday.
    assert.equal(isFetchDue(new Date('2026-09-05T09:05:00Z'), s, null), false);
    assert.equal(isFetchDue(new Date('2026-09-06T09:05:00Z'), s, null), false, 'Sunday too');
    assert.equal(isFetchDue(new Date('2026-09-07T09:05:00Z'), s, null), true);
  });

  it('holds a cadence to its gap, with slack for a late start', () => {
    const every4 = office({ every: '4h' });
    const last = new Date('2026-09-01T08:05:00Z');
    assert.equal(isFetchDue(new Date('2026-09-01T11:05:00Z'), every4, last), false, '3h is short');
    assert.equal(isFetchDue(new Date('2026-09-01T12:04:12Z'), every4, last), true, '3h59m still counts');
    assert.equal(isFetchDue(new Date('2026-09-01T12:05:00Z'), every4, last), true);
  });

  it('runs on the first heartbeat when nothing has ever fetched', () => {
    assert.equal(isFetchDue(new Date('2026-09-01T09:05:00Z'), office({ every: 'day' }), null), true);
  });

  it('a once-a-day search waits a day, not a window', () => {
    const daily = office({ every: 'day' });
    const last = new Date('2026-09-01T08:05:00Z');
    assert.equal(isFetchDue(new Date('2026-09-01T20:05:00Z'), daily, last), false);
    assert.equal(isFetchDue(new Date('2026-09-02T08:05:00Z'), daily, last), true);
  });
});

describe('alerts', () => {
  const windowed = schedule({ alerts: { mode: 'window', from: 8, to: 22, days: [1, 2, 3, 4, 5], digestAt: [9] } });
  const digest = schedule({ alerts: { mode: 'digest', from: 8, to: 22, days: [1, 2, 3, 4, 5, 6, 7], digestAt: [9, 19] } });

  it('instant sends whatever the hour', () => {
    assert.equal(canAlertNow(new Date('2026-09-01T00:05:00Z'), schedule()), true);
  });

  it('window holds outside the hours and outside the days', () => {
    assert.equal(canAlertNow(new Date('2026-09-01T09:05:00Z'), windowed), true, '12:05 Tue');
    assert.equal(canAlertNow(new Date('2026-09-01T02:05:00Z'), windowed), false, '05:05 Tue');
    assert.equal(canAlertNow(new Date('2026-09-05T09:05:00Z'), windowed), false, 'Saturday');
  });

  it('digest never sends on the spot', () => {
    assert.equal(canAlertNow(new Date('2026-09-01T06:05:00Z'), digest), false, 'even at 09:05 the match waits for delivery');
  });

  it('delivers held matches at the digest hours only', () => {
    assert.equal(isDigestHour(new Date('2026-09-01T06:05:00Z'), digest), true, '09:05 Kyiv');
    assert.equal(isDigestHour(new Date('2026-09-01T16:05:00Z'), digest), true, '19:05 Kyiv');
    assert.equal(shouldDeliverHeld(new Date('2026-09-01T07:05:00Z'), digest), false, '10:05 is neither');
  });

  it('delivers held matches on every in-window heartbeat', () => {
    assert.equal(shouldDeliverHeld(new Date('2026-09-01T05:05:00Z'), windowed), true, '08:05 Tue');
    assert.equal(shouldDeliverHeld(new Date('2026-09-01T02:05:00Z'), windowed), false);
  });

  it('flushes leftovers the moment the user goes back to instant', () => {
    assert.equal(shouldDeliverHeld(new Date('2026-09-01T02:05:00Z'), schedule()), true);
  });
});

describe('lastRealFetch', () => {
  it('ignores ticks that did no work, however they ended', () => {
    const runs = [
      { startedAt: new Date('2026-09-01T12:05:00Z'), stats: { skipped: 1, reason: 'outside-schedule' } },
      { startedAt: new Date('2026-09-01T11:05:00Z'), stats: { skipped: 1, reason: 'fetching-paused', ftChecked: 12 } },
      { startedAt: new Date('2026-09-01T10:05:00Z'), stats: { aborted: 1, reason: 'no-active-profile' } },
      { startedAt: new Date('2026-09-01T09:05:00Z'), stats: { fetched: 0, sources: 62 } },
    ];
    assert.deepEqual(lastRealFetch(runs), new Date('2026-09-01T09:05:00Z'));
  });

  it('counts a tick that fetched nothing — it still asked the boards', () => {
    assert.deepEqual(lastRealFetch([{ startedAt: new Date('2026-09-01T09:05:00Z'), stats: { fetched: 0 } }]), new Date('2026-09-01T09:05:00Z'));
  });

  it('is null on a fresh install, and survives a row with no stats at all', () => {
    assert.equal(lastRealFetch([]), null);
    assert.equal(lastRealFetch([{ startedAt: new Date(), stats: null }]), null);
  });
});

describe('nextFetchAt', () => {
  const minute = 5;

  it('names the next heartbeat, never the current instant', () => {
    const at = new Date('2026-09-01T09:05:00Z');
    assert.deepEqual(nextFetchAt(at, office(), null, minute), new Date('2026-09-01T10:05:00Z'));
  });

  it('skips the night and lands on the first hour of the window', () => {
    // 22:05 Kyiv on Tuesday; the window ends at 23:59, so the next is 23:05, then the morning.
    assert.deepEqual(nextFetchAt(new Date('2026-09-01T20:30:00Z'), office(), null, minute), new Date('2026-09-02T04:05:00Z'));
  });

  it('skips the weekend and lands on Monday morning', () => {
    // Friday 2026-09-04, 23:30 Kyiv = 20:30 UTC.
    assert.deepEqual(nextFetchAt(new Date('2026-09-04T20:30:00Z'), office(), null, minute), new Date('2026-09-07T04:05:00Z'));
  });

  it('waits out a cadence gap', () => {
    const last = new Date('2026-09-01T09:05:00Z');
    assert.deepEqual(nextFetchAt(last, office({ every: '4h' }), last, minute), new Date('2026-09-01T13:05:00Z'));
  });
});

describe('the sentences the card and the overview share', () => {
  it('reads a fetch schedule back in one line', () => {
    assert.equal(describeSchedule(office()), 'Every hour, 07:00–23:59, Mon–Fri');
    assert.equal(describeSchedule(defaultSchedule(KYIV)), 'Every hour, around the clock, every day');
    assert.equal(describeSchedule(office({ every: '4h', days: [1, 3, 5] })), 'Every 4 hours, 07:00–23:59, Mon, Wed, Fri');
    assert.equal(describeSchedule(office({ every: 'day', days: [6, 7] })), 'Once a day, 07:00–23:59, weekends');
  });

  it('names days the way a person would', () => {
    assert.equal(describeDays([1, 2, 3, 4, 5, 6, 7]), 'every day');
    assert.equal(describeDays([1, 2, 3, 4, 5]), 'Mon–Fri');
    assert.equal(describeDays([6, 7]), 'weekends');
    assert.equal(describeDays([2, 4]), 'Tue, Thu');
  });

  it('says today, tomorrow or the weekday, in the user\'s zone', () => {
    const now = new Date('2026-09-01T09:05:00Z');
    assert.equal(describeNextFetch(new Date('2026-09-01T10:05:00Z'), now, KYIV), 'today at 13:05');
    assert.equal(describeNextFetch(new Date('2026-09-02T04:05:00Z'), now, KYIV), 'tomorrow at 07:05');
    assert.equal(describeNextFetch(new Date('2026-09-07T04:05:00Z'), now, KYIV), 'Mon at 07:05');
    assert.equal(describeNextFetch(null, now, KYIV), '');
  });

  it('reads the clock in the schedule\'s zone, not UTC', () => {
    const now = new Date('2026-09-01T09:05:00Z');
    assert.equal(describeNextFetch(new Date('2026-09-01T22:05:00Z'), now, KYIV), 'tomorrow at 01:05', 'past midnight in Kyiv');
    assert.equal(describeNextFetch(new Date('2026-09-01T22:05:00Z'), now, 'UTC'), 'today at 22:05');
  });
});

describe('tickAfter', () => {
  it('is always strictly in the future', () => {
    const exact = new Date('2026-09-01T09:05:00Z');
    assert.deepEqual(tickAfter(exact, 5, 0), new Date('2026-09-01T10:05:00Z'));
    assert.deepEqual(tickAfter(new Date('2026-09-01T09:04:59Z'), 5, 0), new Date('2026-09-01T09:05:00Z'));
    assert.deepEqual(tickAfter(exact, 5, 3), new Date('2026-09-01T13:05:00Z'));
  });
});
