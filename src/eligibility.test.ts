import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCountryCode } from './countries';
import { isRelocation, parseResidence, placeNames, residenceCovered } from './eligibility';

describe('the relocation vocabulary', () => {
  it('accepts the three choices and nothing else', () => {
    assert.equal(isRelocation('no'), true);
    assert.equal(isRelocation('sponsorship'), true);
    assert.equal(isRelocation('YES'), false);
    assert.equal(isRelocation(undefined), false);
  });
});

describe('parseResidence', () => {
  it('takes an ISO-2 code in any case and nothing else', () => {
    assert.equal(parseResidence('ua', isCountryCode), 'UA');
    assert.equal(parseResidence(' PL ', isCountryCode), 'PL');
    assert.equal(parseResidence('', isCountryCode), null);
    assert.equal(parseResidence('Ukraine', isCountryCode), null);
    assert.equal(parseResidence('EU', isCountryCode), null);
    assert.equal(parseResidence(42, isCountryCode), null);
  });
});

describe('residenceCovered', () => {
  const eu = { countries: [], regions: ['EU'] };

  it('reads the posting through the gazetteer: member states, groups, worldwide', () => {
    assert.equal(residenceCovered(eu, 'PL'), true);
    assert.equal(residenceCovered(eu, 'UA'), false);
    assert.equal(residenceCovered({ countries: ['DE', 'PL'], regions: [] }, 'PL'), true);
    assert.equal(residenceCovered({ countries: ['DE'], regions: [] }, 'UA'), false);
    assert.equal(residenceCovered({ countries: [], regions: ['EUROPE'] }, 'UA'), true);
    assert.equal(residenceCovered({ countries: [], regions: ['WORLDWIDE'] }, 'UA'), true);
    assert.equal(residenceCovered({ countries: ['US'], regions: ['NORTH_AMERICA'] }, 'CA'), true);
  });

  it('says yes when there is nothing to answer: silence in the posting, or no residence set', () => {
    assert.equal(residenceCovered({ countries: [], regions: [] }, 'UA'), true);
    assert.equal(residenceCovered(eu, null), true);
  });
});

describe('placeNames', () => {
  it('spells codes out for a sentence', () => {
    assert.equal(placeNames(['EU']), 'European Union');
    assert.equal(placeNames(['PL', 'DE']), 'Poland, Germany');
    assert.equal(placeNames([]), '');
  });
});
