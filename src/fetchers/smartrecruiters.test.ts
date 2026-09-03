import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLocation, srLocationHints } from './smartrecruiters';

describe('srLocationHints', () => {
  it('trusts a two-letter country and reads the two booleans', () => {
    assert.deepEqual(srLocationHints({ country: 'de', city: 'Berlin', remote: false, hybrid: true }), {
      countries: ['DE'],
      workplace: 'HYBRID',
    });
    assert.deepEqual(srLocationHints({ country: 'us', remote: true, hybrid: false }), {
      countries: ['US'],
      workplace: 'REMOTE',
    });
  });

  it('ignores a country that is not a code, and a missing location', () => {
    assert.deepEqual(srLocationHints({ country: 'Germany', remote: false, hybrid: false }), {
      countries: [],
      workplace: 'UNKNOWN',
    });
    assert.deepEqual(srLocationHints(null), { countries: [], workplace: 'UNKNOWN' });
  });
});

describe('formatLocation', () => {
  it('prefixes the arrangement and prefers fullLocation', () => {
    assert.equal(formatLocation({ fullLocation: 'Berlin, Germany', remote: true, hybrid: false }), 'Remote · Berlin, Germany');
    assert.equal(formatLocation({ city: 'Sofia', country: 'bg', remote: false, hybrid: true }), 'Hybrid · Sofia, bg');
    assert.equal(formatLocation({ remote: true, hybrid: false }), 'Remote');
    assert.equal(formatLocation(null), '');
  });
});
