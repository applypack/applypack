import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupHeldByTarget, type HeldRow } from './held-alerts';
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
});
