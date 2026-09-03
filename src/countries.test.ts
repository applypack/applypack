import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIGUOUS_NAMES,
  COUNTRIES,
  PLACE_ALIASES,
  REGIONS,
  SUBDIVISION_CODES,
  codeOfFlag,
  codesOfFlags,
  countriesOf,
  findCountry,
  flagOf,
  groupsOf,
  isCountryCode,
  isRegionCode,
  normalizePlace,
  placeLabel,
} from './countries';

describe('gazetteer integrity', () => {
  it('has unique ISO codes and a flag per country', () => {
    const codes = COUNTRIES.map((c) => c.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const c of COUNTRIES) assert.equal(codeOfFlag(c.flag), c.code, c.name);
  });

  it('every region member is a known country', () => {
    for (const r of REGIONS) {
      for (const code of r.countries) assert.ok(isCountryCode(code), `${r.code} → ${code}`);
    }
  });

  it('keeps the EU at 27 and outside the EU: GB, CH, NO, UA', () => {
    assert.equal(countriesOf('EU').length, 27);
    for (const code of ['GB', 'CH', 'NO', 'UA']) {
      assert.ok(!countriesOf('EU').includes(code), code);
      assert.ok(countriesOf('EUROPE').includes(code), code);
    }
  });

  it('WORLDWIDE means every country', () => {
    assert.equal(countriesOf('WORLDWIDE').length, COUNTRIES.length);
    assert.ok(!groupsOf('PL').includes('WORLDWIDE'));
  });

  it('a city never shadows a country name', () => {
    assert.equal(PLACE_ALIASES.get('luxembourg')?.kind, 'country');
    assert.equal(PLACE_ALIASES.get('singapore')?.kind, 'country');
  });

  it('ambiguous names are absent from the alias map', () => {
    for (const name of AMBIGUOUS_NAMES) assert.equal(PLACE_ALIASES.get(name), undefined, name);
  });

  it('abbreviates subdivisions for the US and Canada only', () => {
    assert.equal(SUBDIVISION_CODES.get('TX'), 'US');
    assert.equal(SUBDIVISION_CODES.get('ON'), 'CA');
    assert.equal(SUBDIVISION_CODES.get('BY'), undefined);
  });
});

describe('findCountry', () => {
  it('resolves by code, any name, flag, city and demonym', () => {
    assert.equal(findCountry('pl')?.code, 'PL');
    assert.equal(findCountry('Poland')?.code, 'PL');
    assert.equal(findCountry('Polska')?.code, 'PL');
    assert.equal(findCountry('Польща')?.code, 'PL');
    assert.equal(findCountry('🇵🇱')?.code, 'PL');
    assert.equal(findCountry('🇵🇱 Poland')?.code, 'PL');
    assert.equal(findCountry('Kraków')?.code, 'PL');
    assert.equal(findCountry('krakow')?.code, 'PL');
    assert.equal(findCountry('Polish')?.code, 'PL');
  });

  it('knows the long ISO forms WWR sends', () => {
    assert.equal(findCountry('United Kingdom of Great Britain and Northern Ireland')?.code, 'GB');
    assert.equal(findCountry('Korea (Republic of)')?.code, 'KR');
    assert.equal(findCountry('Viet Nam')?.code, 'VN');
  });

  it('resolves Georgia only through a city, never the bare name', () => {
    assert.equal(findCountry('Georgia'), null);
    assert.equal(findCountry('Tbilisi')?.code, 'GE');
    assert.equal(findCountry('Atlanta')?.code, 'US');
  });

  it('returns null for regions, unknown places and empty input', () => {
    assert.equal(findCountry('Europe'), null);
    assert.equal(findCountry('Narnia'), null);
    assert.equal(findCountry('  '), null);
  });
});

describe('groups and codes', () => {
  it('lists the groups a country belongs to', () => {
    const pl = groupsOf('PL');
    for (const g of ['EU', 'EEA', 'EUROPE', 'CEE', 'EMEA']) assert.ok(pl.includes(g), g);
    assert.ok(!pl.includes('NORDICS'));
  });

  it('tells region codes from country codes', () => {
    assert.ok(isRegionCode('EU'));
    assert.ok(!isCountryCode('EU'));
    assert.ok(isCountryCode('DE'));
    assert.ok(!isRegionCode('DE'));
  });

  it('labels and flags both kinds', () => {
    assert.equal(placeLabel('DE'), 'Germany');
    assert.equal(placeLabel('EU'), 'European Union');
    assert.equal(placeLabel('XX'), 'XX');
    assert.equal(flagOf('UA'), '🇺🇦');
    assert.equal(flagOf('WORLDWIDE'), '🌍');
    assert.equal(flagOf('EMEA'), '');
  });
});

describe('flags and normalisation', () => {
  it('decodes one flag and ignores anything else', () => {
    assert.equal(codeOfFlag('🇺🇦'), 'UA');
    assert.equal(codeOfFlag(' 🇩🇪 '), 'DE');
    assert.equal(codeOfFlag('🇩🇪 Germany'), null);
    assert.equal(codeOfFlag('DE'), null);
  });

  it('collects every known flag in a text once, in order', () => {
    assert.deepEqual(codesOfFlags('🇵🇱 Poland, 🇷🇴 Romania, 🇵🇱 again, 🇽🇰 Kosovo'), ['PL', 'RO']);
  });

  it('normalises accents, dots, hyphens and non-breaking spaces', () => {
    assert.equal(normalizePlace('U.S.'), 'us');
    assert.equal(normalizePlace('Zürich'), 'zurich');
    assert.equal(normalizePlace('Cluj-Napoca'), 'cluj napoca');
    assert.equal(normalizePlace('New York'), 'new york');
    assert.equal(normalizePlace("St. John's"), 'st johns');
  });
});
