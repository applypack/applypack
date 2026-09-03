import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, findCountry } from '../countries';

// The browser copy ships as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file.
const picker = import('./public/countries.mjs') as Promise<{
  SUGGESTION_LIMIT: number;
  normalize: (s: string) => string;
  searchCountries: (
    q: string,
    countries: readonly { code: string; name: string; flag: string; names: string[]; demonyms: string[]; cities: string[] }[],
    limit?: number,
  ) => { country: { code: string; name: string; flag: string }; via: string }[];
  chipText: (c: { flag: string; name: string }) => string;
}>;

/*
 * The picker searches the same gazetteer the server resolves against, so a
 * chip it produces must resolve with findCountry — that round trip is the
 * contract, tested here.
 */

test('finds a country by code, name, local name, Ukrainian name, city and demonym', async () => {
  const { searchCountries } = await picker;
  const top = (q: string) => searchCountries(q, COUNTRIES)[0];
  assert.equal(top('pl')?.country.code, 'PL');
  assert.equal(top('Pola')?.country.code, 'PL');
  assert.equal(top('Polska')?.country.code, 'PL');
  assert.equal(top('Польща')?.country.code, 'PL');
  assert.equal(top('Krak')?.country.code, 'PL');
  assert.equal(top('krakow')?.via, 'Krakow');
  assert.equal(top('Polish')?.country.code, 'PL');
});

test('ranks an exact code and a name prefix above a city or a substring', async () => {
  const { searchCountries } = await picker;
  assert.equal(searchCountries('de', COUNTRIES)[0]?.country.code, 'DE');
  assert.equal(searchCountries('in', COUNTRIES)[0]?.country.code, 'IN');
  const ger = searchCountries('ger', COUNTRIES).map((h) => h.country.code);
  assert.equal(ger[0], 'DE');
  // "land" is inside many names; a substring needs three letters and ranks last.
  assert.ok(searchCountries('land', COUNTRIES).length > 1);
  assert.deepEqual(searchCountries('la', COUNTRIES).filter((h) => h.via.toLowerCase().includes('land')), []);
  // A city matches only at its start: "pol" is Poland, never Napoli or Minneapolis.
  assert.deepEqual(searchCountries('pol', COUNTRIES).map((h) => h.country.code), ['PL']);
});

test('caps the list and returns nothing for an empty or unknown query', async () => {
  const { searchCountries, SUGGESTION_LIMIT } = await picker;
  assert.equal(searchCountries('a', COUNTRIES).length, SUGGESTION_LIMIT);
  assert.equal(searchCountries('a', COUNTRIES, 3).length, 3);
  assert.deepEqual(searchCountries('   ', COUNTRIES), []);
  assert.deepEqual(searchCountries('Narnia', COUNTRIES), []);
});

test('Georgia resolves through its cities, never the bare name', async () => {
  const { searchCountries } = await picker;
  const geo = searchCountries('Georgia', COUNTRIES);
  assert.equal(geo[0]?.country.code, 'GE');
  assert.equal(searchCountries('Tbilisi', COUNTRIES)[0]?.country.code, 'GE');
});

test('a chip round-trips through findCountry', async () => {
  const { chipText, searchCountries } = await picker;
  for (const q of ['Poland', 'Deutschland', 'Kyiv', 'uk', 'Nederland']) {
    const hit = searchCountries(q, COUNTRIES)[0];
    assert.ok(hit, q);
    assert.equal(findCountry(chipText(hit.country))?.code, hit.country.code, q);
  }
  assert.equal(chipText({ flag: '🇵🇱', name: 'Poland' }), '🇵🇱 Poland');
});

test('normalises like the server does', async () => {
  const { normalize } = await picker;
  assert.equal(normalize('Zürich'), 'zurich');
  assert.equal(normalize("St. John's"), 'st johns');
  assert.equal(normalize('Cluj-Napoca'), 'cluj napoca');
});
