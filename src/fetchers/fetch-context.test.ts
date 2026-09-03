import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_CONTEXT, searchPlaces } from './fetch-context';

describe('searchPlaces', () => {
  it('unions the places of every running search, once each', () => {
    assert.deepEqual(
      searchPlaces([
        { countries: ['PL', 'DE'], regions: ['EU'] },
        { countries: ['DE', 'US'], regions: [] },
      ]),
      { countries: ['PL', 'DE', 'US'], regions: ['EU'] },
    );
  });

  it('one search that hunts anywhere makes the context anywhere', () => {
    assert.deepEqual(searchPlaces([{ countries: ['PL'], regions: [] }, { countries: [], regions: [] }]), EMPTY_CONTEXT);
    assert.deepEqual(searchPlaces([{ countries: ['PL'], regions: ['WORLDWIDE'] }]), EMPTY_CONTEXT);
  });

  it('no searches is anywhere too', () => {
    assert.deepEqual(searchPlaces([]), EMPTY_CONTEXT);
  });
});
