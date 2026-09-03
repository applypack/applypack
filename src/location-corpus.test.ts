import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocation } from './location';
import corpus from './location-corpus.json';

/*
 * Every distinct Job.location string the live database held on 2026-09-03
 * (250 strings, 1 038 jobs), with the reading reviewed by hand and pinned.
 * A parser change that moves one of these rows has to say why here — the
 * fixture is the backfill's expected output, not a snapshot to regenerate.
 */

describe('location parser over the stored corpus', () => {
  for (const row of corpus) {
    it(`${JSON.stringify(row.location)} → ${row.workplace} ${row.countries.join(',') || '—'} ${row.regions.join(',')}`, () => {
      const parsed = parseLocation(row.location);
      assert.equal(parsed.workplace, row.workplace);
      assert.deepEqual(parsed.countries, row.countries);
      assert.deepEqual(parsed.regions, row.regions);
    });
  }

  it('covers the whole corpus and leaves the bare-Remote rows without a country', () => {
    assert.equal(corpus.length, 250);
    const bare = corpus.find((r) => r.location === 'Remote');
    assert.deepEqual(bare && [bare.workplace, bare.countries, bare.regions], ['REMOTE', [], []]);
  });
});
