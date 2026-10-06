import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SETTLE_MS } from '../datasets/folder-scan';
import { WATCH_SETTLE_MS, watchChanges } from './folder-watch-plan';

describe('watchChanges', () => {
  it('starts a folder switched on, stops one switched off, and leaves the rest alone', () => {
    const current = new Map([
      [1, '/home/sam/a'],
      [2, '/home/sam/b'],
    ]);
    const wanted = new Map([
      [2, '/home/sam/b'],
      [3, '/home/sam/c'],
    ]);
    assert.deepEqual(watchChanges(wanted, current), { start: [{ id: 3, path: '/home/sam/c' }], stop: [1] });
  });

  it('moves a watcher whose folder moved', () => {
    assert.deepEqual(watchChanges(new Map([[1, '/new']]), new Map([[1, '/old']])), { start: [{ id: 1, path: '/new' }], stop: [1] });
  });

  it('changes nothing when nothing changed', () => {
    const same = new Map([[1, '/a']]);
    assert.deepEqual(watchChanges(same, new Map(same)), { start: [], stop: [] });
  });
});

it('lets a change settle longer than a look waits for a fresh file, so the look that follows reads it', () => {
  assert.ok(WATCH_SETTLE_MS > SETTLE_MS);
});
