import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLabel } from './source-names';

describe('sourceLabel', () => {
  it('maps enum values to display names', () => {
    assert.equal(sourceLabel('LARAJOBS_RSS'), 'Laravel Jobs');
    assert.equal(sourceLabel('WEWORKREMOTELY'), 'We Work Remotely');
    assert.equal(sourceLabel('HN_HIRING'), 'HN Who is hiring');
    assert.equal(sourceLabel('GREENHOUSE'), 'Greenhouse');
  });

  it('passes unknown values through unchanged', () => {
    assert.equal(sourceLabel('NEW_BOARD'), 'NEW_BOARD');
  });
});
