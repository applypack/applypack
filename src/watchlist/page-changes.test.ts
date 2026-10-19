import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { beginPageChangeTick, pageStats, stagePageChange, takePageChanges } from './page-changes';

const base = { companyId: 1, companyName: 'Todoist', url: 'https://todoist.com/careers' };

describe('pageStats (#533)', () => {
  it('counts what the walk found on the watched pages, and only what happened', () => {
    beginPageChangeTick();
    stagePageChange({ ...base, kind: 'first', hash: 'a' });
    stagePageChange({ ...base, companyId: 2, kind: 'changed', hash: 'b' });
    stagePageChange({ ...base, companyId: 3, kind: 'held' });
    stagePageChange({ ...base, companyId: 4, kind: 'held' });
    assert.deepEqual(pageStats(takePageChanges()), { pagesFirstRead: 1, pageChangesFound: 1, pageChangesHeld: 2 });
    assert.deepEqual(pageStats(takePageChanges()), {});
  });
});
