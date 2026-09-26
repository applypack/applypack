import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pausedFamilies, toAtsTypes } from './settings';

describe('toAtsTypes', () => {
  it('drops a stored value that is no longer a source, so the enum filter cannot throw', () => {
    assert.deepEqual(toAtsTypes(['REMOTEOK', 'NOT_A_SOURCE']), ['REMOTEOK']);
  });
});

describe('pausedFamilies', () => {
  it('is the families switched off on Settings → Sources while the HN parser is on', () => {
    assert.deepEqual(pausedFamilies({ disabledSources: ['WORKABLE'], hnParserEnabled: true }), ['WORKABLE']);
  });

  it('adds the HN thread while its parser is off on /discovery — either switch stops it', () => {
    assert.deepEqual(pausedFamilies({ disabledSources: ['WORKABLE'], hnParserEnabled: false }), ['WORKABLE', 'HN_HIRING']);
  });

  it('names it once when both switches are off', () => {
    assert.deepEqual(pausedFamilies({ disabledSources: ['HN_HIRING'], hnParserEnabled: false }), ['HN_HIRING']);
  });
});
