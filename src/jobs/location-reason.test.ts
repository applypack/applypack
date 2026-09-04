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

  it('explains what the search\'s own list cannot: the candidate does not live there (ADR 0033)', () => {
    const uaEu = { ...eu, residence: 'UA', relocation: 'no' };
    assert.equal(
      locationMismatchReason({ workplace: 'REMOTE', countries: [], regions: ['EU'] }, uaEu),
      'open to European Union; you live in Ukraine and this search does not relocate',
    );
    assert.equal(
      locationMismatchReason({ workplace: 'HYBRID', countries: ['PL'], regions: [] }, { ...uaEu, relocation: 'sponsorship' }),
      'office in Poland; you live in Ukraine',
    );
    // A search that hunts anywhere still has a residence to answer for.
    assert.equal(
      locationMismatchReason({ workplace: 'REMOTE', countries: ['US'], regions: [] }, { countries: [], regions: [], workplace: [], residence: 'UA', relocation: 'no' }),
      'open to United States; you live in Ukraine and this search does not relocate',
    );
  });

  it('says nothing about residence when the posting covers it, or none is set', () => {
    const uaEu = { ...eu, residence: 'UA', relocation: 'no' };
    assert.equal(locationMismatchReason({ workplace: 'REMOTE', countries: [], regions: ['EUROPE'] }, uaEu), null);
    assert.equal(locationMismatchReason({ workplace: 'REMOTE', countries: [], regions: ['WORLDWIDE'] }, uaEu), null);
    assert.equal(locationMismatchReason({ workplace: 'REMOTE', countries: ['UA', 'PL'], regions: [] }, uaEu), null);
    assert.equal(locationMismatchReason({ workplace: 'REMOTE', countries: [], regions: ['EU'] }, eu), null);
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
