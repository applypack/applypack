import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neverUsedSource } from './companies';

test('a source that came switched off and was never read is folded away; anything used stays (#770)', () => {
  assert.equal(neverUsedSource({ active: false, lastFetchedAt: null, jobsTotal: 0 }), true);
  assert.equal(neverUsedSource({ active: true, lastFetchedAt: null, jobsTotal: 0 }), false, 'switched on, waiting for its first read');
  assert.equal(neverUsedSource({ active: false, lastFetchedAt: new Date(), jobsTotal: 0 }), false, 'read once, then switched off');
  assert.equal(neverUsedSource({ active: false, lastFetchedAt: null, jobsTotal: 3 }), false, 'holds jobs: an import, pasted postings');
});
