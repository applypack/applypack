import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, placeLabel } from '../countries';
import { WORKPLACE_CODES, WORKPLACE_LABEL } from '../location';
import { MESSAGE_KEYS } from './catalog';
import { withLocale } from './locale';
import { placeName, workplaceName } from './places';

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
