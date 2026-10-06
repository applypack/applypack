import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, REGIONS, placeLabel, resolveCountries } from '../countries';
import { WORKPLACE_CODES, WORKPLACE_LABEL } from '../location';
import { MESSAGE_KEYS } from './catalog';
import { withLocale } from './locale';
import { parseTagList } from '../text-utils';
import { countryChip, placeName, workplaceName } from './places';

describe('placeName', () => {
  it('is the gazetteer\'s own name in English, for a country and for a group', () => {
    assert.equal(placeName('DE'), 'Germany');
    assert.equal(placeName('US'), placeLabel('US'));
    for (const region of REGIONS) assert.equal(placeName(region.code), region.label, region.code);
  });

  it('has a catalog name for every group the gazetteer defines', () => {
    const keys = new Set<string>(MESSAGE_KEYS);
    for (const region of REGIONS) assert.ok(keys.has(`place.group.${region.code}`), `place.group.${region.code} is missing from en.json`);
  });

  it('is the language\'s own name elsewhere', () => {
    assert.equal(withLocale('uk', () => placeName('DE')), 'Німеччина');
    assert.equal(withLocale('uk', () => placeName('EUROPE')), 'Європа');
    assert.equal(withLocale('uk', () => placeName('WORLDWIDE')), 'Увесь світ');
  });

  it('gives back a code nobody knows', () => {
    assert.equal(placeName('ZZ'), 'ZZ');
  });
});

describe('workplaceName', () => {
  it('matches the stored English label, and translates', () => {
    for (const code of WORKPLACE_CODES) assert.equal(workplaceName(code), WORKPLACE_LABEL[code]);
    assert.equal(withLocale('uk', () => workplaceName('REMOTE')), 'Віддалено');
  });
});

describe('countryChip', () => {
  // The Searches editor and the wizard put these lines in a textarea, and the save splits it on commas.
  for (const locale of ['en', 'uk'] as const) {
    it(`goes back to the same countries through the save's own parsing (${locale})`, () => {
      const codes = COUNTRIES.map((c) => c.code);
      const chips = withLocale(locale, () => codes.map(countryChip));
      assert.deepEqual(resolveCountries(parseTagList(chips.join('\n'))), { codes, unknown: [] });
    });
  }

  it('keeps the first part of a name that carries a comma', () => {
    assert.equal(withLocale('uk', () => countryChip('HK')), '🇭🇰 Гонконг');
  });
});

