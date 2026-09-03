import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAiLocation } from './location-merge';
import type { ParsedLocation } from '../location';

const parsed = (over: Partial<ParsedLocation> = {}): ParsedLocation => ({
  workplace: 'REMOTE',
  countries: ['US', 'CA'],
  regions: [],
  source: 'parsed',
  ...over,
});

describe('mergeAiLocation', () => {
  it('keeps the parser reading when the model says nothing', () => {
    assert.deepEqual(mergeAiLocation(parsed(), null), parsed());
  });

  it('fills what the parser left blank', () => {
    const out = mergeAiLocation(parsed({ workplace: 'UNKNOWN', countries: [], regions: [], source: null }), {
      workplace: 'REMOTE',
      countries: ['PL'],
      regions: ['EU'],
    });
    assert.deepEqual(out, { workplace: 'REMOTE', countries: ['PL'], regions: ['EU'], source: 'ai' });
  });

  it('narrows a multi-country line but never widens or replaces it', () => {
    assert.deepEqual(mergeAiLocation(parsed(), { workplace: 'REMOTE', countries: ['US'], regions: [] }).countries, ['US']);
    assert.deepEqual(mergeAiLocation(parsed(), { workplace: 'REMOTE', countries: ['US', 'CA', 'MX'], regions: [] }).countries, ['US', 'CA']);
    assert.deepEqual(mergeAiLocation(parsed(), { workplace: 'REMOTE', countries: ['PL'], regions: [] }).countries, ['US', 'CA']);
  });

  it('never blanks out a structured hint', () => {
    const structured = parsed({ source: 'structured' });
    const out = mergeAiLocation(structured, { workplace: 'UNKNOWN', countries: [], regions: [] });
    assert.deepEqual(out, structured);
  });

  it('takes the arrangement only when the parser had none', () => {
    assert.equal(mergeAiLocation(parsed({ workplace: 'UNKNOWN' }), { workplace: 'HYBRID', countries: [], regions: [] }).workplace, 'HYBRID');
    assert.equal(mergeAiLocation(parsed({ workplace: 'REMOTE' }), { workplace: 'HYBRID', countries: [], regions: [] }).workplace, 'REMOTE');
  });

  it('marks the source ai only when something changed', () => {
    assert.equal(mergeAiLocation(parsed(), { workplace: 'REMOTE', countries: ['US', 'CA'], regions: [] }).source, 'parsed');
    assert.equal(mergeAiLocation(parsed({ countries: [] }), { workplace: 'REMOTE', countries: [], regions: ['AMERICAS'] }).source, 'ai');
  });

  it('ignores a region the model derives next to a parsed country', () => {
    const out = mergeAiLocation(parsed({ countries: ['PL'] }), { workplace: 'REMOTE', countries: ['PL'], regions: ['EMEA'] });
    assert.deepEqual(out, { workplace: 'REMOTE', countries: ['PL'], regions: [], source: 'parsed' });
  });
});
