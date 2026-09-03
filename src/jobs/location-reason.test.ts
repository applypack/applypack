import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { locationMismatchReason } from './location-reason';

const us = { countries: ['US'], regions: ['AMERICAS'], workplace: ['REMOTE' as const] };
const eu = { countries: ['PL', 'DE'], regions: ['EU'], workplace: ['REMOTE' as const, 'HYBRID' as const] };

describe('locationMismatchReason', () => {
  it('names the arrangement the search does not accept', () => {
    assert.equal(
      locationMismatchReason({ workplace: 'HYBRID', countries: ['DE'], regions: [] }, us),
      'hybrid role; this search accepts remote',
    );
    assert.equal(
      locationMismatchReason({ workplace: 'ONSITE', countries: [], regions: [] }, eu),
      'on-site role; this search accepts remote / hybrid',
    );
  });

  it('names the places on both sides when they do not overlap', () => {
    assert.equal(
      locationMismatchReason({ workplace: 'REMOTE', countries: ['PL'], regions: [] }, us),
      'open to Poland; this search hunts in United States, Americas',
    );
    assert.equal(
      locationMismatchReason({ workplace: 'HYBRID', countries: ['IN'], regions: [] }, eu),
      'office in India; this search hunts in Poland, Germany, European Union',
    );
    assert.equal(
      locationMismatchReason({ workplace: 'REMOTE', countries: [], regions: ['EU'] }, us),
      'open to European Union; this search hunts in United States, Americas',
    );
  });

  it('says when the posting names no place at all', () => {
    assert.equal(
      locationMismatchReason({ workplace: 'REMOTE', countries: [], regions: [] }, us),
      'no country named; this search hunts in United States, Americas',
    );
  });

  it('has nothing to add when the columns agree or say nothing', () => {
    assert.equal(locationMismatchReason({ workplace: 'REMOTE', countries: ['US'], regions: [] }, us), null);
    assert.equal(locationMismatchReason({ workplace: 'REMOTE', countries: ['PL'], regions: [] }, eu), null);
    assert.equal(locationMismatchReason({ workplace: 'REMOTE', countries: [], regions: ['EUROPE'] }, eu), null);
    const anywhere = { countries: [], regions: [], workplace: [] };
    assert.equal(locationMismatchReason({ workplace: 'ONSITE', countries: ['IN'], regions: [] }, anywhere), null);
    assert.equal(locationMismatchReason({ workplace: 'UNKNOWN', countries: [], regions: [] }, anywhere), null);
  });
});
