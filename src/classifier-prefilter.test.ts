import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrefilterResponse } from './classifier-prefilter';

describe('parsePrefilterResponse', () => {
  it('parses clean JSON', () => {
    const out = parsePrefilterResponse('{"relevant":true,"reason":"php in title"}');
    assert.deepEqual(out, { relevant: true, reason: 'php in title' });
  });

  it('parses JSON wrapped in prose', () => {
    const out = parsePrefilterResponse(
      'Here is my answer:\n{"relevant": false, "reason": "frontend-only"}\n',
    );
    assert.deepEqual(out, { relevant: false, reason: 'frontend-only' });
  });

  it('returns null for malformed JSON', () => {
    assert.equal(parsePrefilterResponse('{relevant: true}'), null);
    assert.equal(parsePrefilterResponse('not json'), null);
  });

  it('returns null when required fields are missing', () => {
    assert.equal(parsePrefilterResponse('{"relevant":true}'), null);
    assert.equal(parsePrefilterResponse('{"reason":"x"}'), null);
  });

  it('returns null when types are wrong', () => {
    assert.equal(parsePrefilterResponse('{"relevant":"yes","reason":"x"}'), null);
    assert.equal(parsePrefilterResponse('{"relevant":true,"reason":42}'), null);
  });
});
