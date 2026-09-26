import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupHeldByTarget, heldReason, HELD_LIST_MAX, type HeldRow } from './held-alerts';
import type { AlertJob } from '../types';

function row(id: number, targetId: number | null): HeldRow {
  return { id, targetId, alert: { title: `job ${id}` } as AlertJob };
}

describe('groupHeldByTarget', () => {
  it('sends one message per chat and keeps the order the rows came in', () => {
    const groups = groupHeldByTarget([row(1, 7), row(2, 9), row(3, 7)]);
    assert.deepEqual(groups.map((g) => [g.targetId, g.ids]), [[7, [1, 3]], [9, [2]]]);
  });

  it('keeps the broadcast group apart, so a routed chat is not sent it twice', () => {
    const groups = groupHeldByTarget([row(1, null), row(2, 7), row(3, null)]);
    assert.deepEqual(groups.map((g) => [g.targetId, g.ids]), [[null, [1, 3]], [7, [2]]]);
  });

  it('has nothing to send when nothing is held', () => {
    assert.deepEqual(groupHeldByTarget([]), []);
  });

  it('lists the first ones of a long wait and counts the rest, per chat', () => {
    const rows = [row(1, 7), row(2, 7), row(3, 9), row(4, 7), row(5, 7)];
    const groups = groupHeldByTarget(rows, 2);
    assert.deepEqual(
      groups.map((g) => [g.targetId, g.ids, g.alerts.map((a) => a.title), g.unlisted]),
      [
        [7, [1, 2], ['job 1', 'job 2'], [4, 5]],
        [9, [3], ['job 3'], []],
      ],
    );
  });

  it('lists twenty by default, so a fortnight with Alerts off is one short message', () => {
    const groups = groupHeldByTarget(Array.from({ length: 57 }, (_, i) => row(i + 1, null)));
    assert.equal(HELD_LIST_MAX, 20);
    assert.equal(groups[0]!.ids.length, 20);
    assert.equal(groups[0]!.unlisted.length, 37);
  });
});

describe('heldReason', () => {
  it('names no chat first, then the switch, whatever the schedule says', () => {
    assert.equal(heldReason('no-targets', 'window'), 'no-targets');
    assert.equal(heldReason('alerts-off', 'digest'), 'alerts-off');
    assert.equal(heldReason('alerts-off', 'instant'), 'alerts-off');
  });

  it('waits for the window or the digest time when alerts can go out', () => {
    assert.equal(heldReason('open', 'window'), 'window');
    assert.equal(heldReason('open', 'digest'), 'window');
  });

  it('sends at the next check when alerts go out right away', () => {
    assert.equal(heldReason('open', 'instant'), 'next-check');
  });
});
