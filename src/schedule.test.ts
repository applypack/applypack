import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cronMinute, spreadMinute, withMinute } from './schedule';

/** A plausible spread of installs: uuid-shaped ids, all distinct. */
function instanceIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `3f2b${i.toString(16).padStart(8, '0')}-aaaa-4bbb-8ccc-ddddeeeeffff`);
}

describe('cronMinute', () => {
  it('stays inside the hour', () => {
    for (const id of instanceIds(500)) {
      const minute = cronMinute(id, 'fetch');
      assert.ok(Number.isInteger(minute) && minute >= 0 && minute < 60, `${minute}`);
    }
  });

  it('refuses an empty id instead of silently putting every install on one minute', () => {
    assert.throws(() => cronMinute('', 'fetch'), /instanceId/);
  });

  it('is stable for the same install and job', () => {
    const id = 'c0ffee00-1111-4222-8333-444455556666';
    assert.equal(cronMinute(id, 'fetch'), cronMinute(id, 'fetch'));
  });

  it('gives fetch and discovery different minutes, so they never start together', () => {
    // fetch runs every hour and discovery on Sunday 04:00 — one minute per
    // install would collide them weekly on every install.
    const collisions = instanceIds(500).filter(
      (id) => cronMinute(id, 'fetch') === cronMinute(id, 'discovery'),
    );
    // 1/60 of the ids will collide by chance; the point is that the minute
    // is not shared by construction.
    assert.ok(collisions.length < 25, `${collisions.length} of 500 collided`);
  });

  it('spreads installs across the hour instead of stacking them', () => {
    const buckets = new Map<number, number>();
    for (const id of instanceIds(6_000)) {
      const minute = cronMinute(id, 'fetch');
      buckets.set(minute, (buckets.get(minute) ?? 0) + 1);
    }
    assert.equal(buckets.size, 60, 'every minute of the hour is used');
    // 6000/60 = 100 expected per minute; a hash this poor would be visible
    // long before a 3x pile-up.
    for (const [minute, count] of buckets) {
      assert.ok(count < 300, `minute ${minute} took ${count} of 6000`);
    }
  });
});

describe('withMinute', () => {
  it('replaces only the minute field', () => {
    assert.equal(withMinute('5 * * * *', 41), '41 * * * *');
    assert.equal(withMinute('0 6 1 * *', 7), '7 6 1 * *');
    assert.equal(withMinute('0 4 * * 0', 0), '0 4 * * 0');
  });

  it('refuses an expression that is not five fields', () => {
    assert.throws(() => withMinute('* * * *', 1), /five-field/);
  });
});

describe('spreadMinute', () => {
  const id = 'c0ffee00-1111-4222-8333-444455556666';

  it('moves the jobs that hit somebody else’s server', () => {
    for (const job of ['fetch', 'hn-hiring', 'discovery']) {
      const moved = spreadMinute('5 * * * *', id, job);
      assert.equal(moved.split(' ').slice(1).join(' '), '* * * *', job);
      assert.equal(moved.split(' ')[0], String(cronMinute(id, job)), job);
    }
  });

  it('leaves the user’s own schedules exactly as written', () => {
    // 09:00 digest means 09:00 — nobody else is on the other end.
    assert.equal(spreadMinute('0 9 * * *', id, 'digest'), '0 9 * * *');
    assert.equal(spreadMinute('0 8 * * *', id, 'stale-applications'), '0 8 * * *');
    assert.equal(spreadMinute('0 3 * * 0', id, 'cleanup'), '0 3 * * 0');
  });
});
