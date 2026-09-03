import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocation, placesFromText, workplaceFromText } from './location';

const countries = (text: string) => parseLocation(text).countries;
const regions = (text: string) => parseLocation(text).regions;

describe('workplaceFromText', () => {
  it('reads the three arrangements and their spellings', () => {
    assert.equal(workplaceFromText('Remote US'), 'REMOTE');
    assert.equal(workplaceFromText('REMOTE (US)'), 'REMOTE');
    assert.equal(workplaceFromText('Home Based - Americas'), 'REMOTE');
    assert.equal(workplaceFromText('Homeoffice'), 'REMOTE');
    assert.equal(workplaceFromText('Київ, віддалено'), 'REMOTE');
    assert.equal(workplaceFromText('Milan (Hybrid)'), 'HYBRID');
    assert.equal(workplaceFromText('San Francisco (on-site)'), 'ONSITE');
    assert.equal(workplaceFromText('ONSITE (San Francisco)'), 'ONSITE');
  });

  it('is UNKNOWN when nothing states the arrangement', () => {
    assert.equal(workplaceFromText('Berlin, Germany'), 'UNKNOWN');
    assert.equal(workplaceFromText(''), 'UNKNOWN');
  });

  it('picks the softest arrangement when several offices differ', () => {
    assert.equal(workplaceFromText('Denver, CO - Hybrid; New York, NY; San Francisco, CA - Hybrid'), 'HYBRID');
    assert.equal(workplaceFromText('Atlanta, GA - Remote; Denver, CO - Hybrid'), 'REMOTE');
    assert.equal(workplaceFromText('REMOTE (NA/LATAM/EU) + ONSITE (San Francisco)'), 'REMOTE');
  });
});

describe('parseLocation — the traps (plan §7.1)', () => {
  it('bare "Remote" is remote with no country and no region — never worldwide', () => {
    assert.deepEqual(parseLocation('Remote'), {
      workplace: 'REMOTE',
      countries: [],
      regions: [],
      source: 'parsed',
    });
    assert.deepEqual(regions('REMOTE'), []);
    assert.deepEqual(regions('Remote (Worldwide)'), ['WORLDWIDE']);
  });

  it('Georgia resolves through the city, never the bare name', () => {
    assert.deepEqual(countries('Atlanta, Georgia'), ['US']);
    assert.deepEqual(countries('Tbilisi, Georgia'), ['GE']);
    assert.deepEqual(countries('Georgia'), []);
    assert.deepEqual(countries('Remote, Georgia'), []);
  });

  it('a two-letter code that is also a US state is a state after a city', () => {
    assert.deepEqual(countries('San Francisco, CA'), ['US']);
    assert.deepEqual(countries('Indianapolis, IN'), ['US']);
    assert.deepEqual(countries('Wilmington, DE'), ['US']);
    assert.deepEqual(countries('Portland, OR'), ['US']);
    assert.deepEqual(countries('Boise, ID'), ['US']);
    assert.deepEqual(countries('Billings, MT'), ['US']);
    assert.deepEqual(countries('Portland, ME'), ['US']);
  });

  it('… and a country after "Remote" or a marker', () => {
    assert.deepEqual(countries('Remote (US)'), ['US']);
    assert.deepEqual(countries('Remote · DE'), ['DE']);
    assert.deepEqual(countries('Remote, CA'), ['CA']);
    assert.deepEqual(countries('Remote IN'), ['IN']);
    assert.deepEqual(countries('DE only'), ['DE']);
  });

  it('… and a country after another code or a region', () => {
    assert.deepEqual(countries('US, CA, GB'), ['US', 'CA', 'GB']);
    assert.deepEqual(countries('Europe, DE'), ['DE']);
    assert.deepEqual(regions('Europe, DE'), ['EUROPE']);
    assert.deepEqual(countries('Ontario, CA'), ['CA']);
    assert.deepEqual(countries('Texas, US'), ['US']);
  });

  it('… and the city decides when it is known', () => {
    assert.deepEqual(countries('Kyiv, UA'), ['UA']);
    assert.deepEqual(countries('Київ, UA'), ['UA']);
    assert.deepEqual(countries('Bangalore, IN'), ['IN']);
    assert.deepEqual(countries('Berlin, DE'), ['DE']);
    assert.deepEqual(countries('Amsterdam, NL'), ['NL']);
  });

  it('"City, ST" overrides a city name that exists elsewhere', () => {
    assert.deepEqual(countries('Birmingham, AL'), ['US']);
    assert.deepEqual(countries('Paris, TX'), ['US']);
    assert.deepEqual(countries('Athens, GA'), ['US']);
    assert.deepEqual(countries('Birmingham, United Kingdom'), ['GB']);
  });

  it('"US" only as a whole word — never inside Russia, Australia, campus, bonus', () => {
    assert.deepEqual(countries('Russia'), []);
    assert.deepEqual(countries('Australia'), ['AU']);
    assert.deepEqual(countries('Main campus, signing bonus'), []);
    assert.deepEqual(countries('US-Remote'), ['US']);
    assert.deepEqual(countries('Remote (U.S.)'), ['US']);
    assert.deepEqual(countries('REMOTE (USA ONLY)'), ['US']);
  });

  it('a lowercase or mid-sentence two-letter word is not a code', () => {
    assert.deepEqual(countries('Remote in the us'), []);
    assert.deepEqual(countries('Instinct Science is the AI leader'), []);
    assert.deepEqual(countries('YC P26'), []);
  });

  it('UK is not the EU and the EU is not the UK', () => {
    assert.deepEqual(parseLocation('Remote UK').countries, ['GB']);
    assert.deepEqual(parseLocation('Remote UK').regions, []);
    assert.deepEqual(parseLocation('Remote · EU only').countries, []);
    assert.deepEqual(parseLocation('Remote · EU only').regions, ['EU']);
    assert.deepEqual(regions('Europe'), ['EUROPE']);
    assert.deepEqual(regions('European Union'), ['EU']);
  });

  it('several offices → every country, softest arrangement', () => {
    const p = parseLocation('Denver, CO - Hybrid; New York, New York, United States; London, United Kingdom - Remote');
    assert.equal(p.workplace, 'REMOTE');
    assert.deepEqual(p.countries, ['US', 'GB']);
    assert.deepEqual(countries('Remote, Canada; Remote, United States'), ['CA', 'US']);
    assert.deepEqual(countries('Vancouver, BC, Canada, San Francisco Bay Area, CA, US, Chicago, IL, US'), ['CA', 'US']);
  });

  it('time zones are a soft region, not a country', () => {
    assert.deepEqual(parseLocation('Remote · Time zone: CET (+/- 3 hours)'), {
      workplace: 'REMOTE',
      countries: [],
      regions: ['EUROPE'],
      source: 'parsed',
    });
    assert.deepEqual(regions('Remote (EU time zones)'), ['EUROPE']);
    assert.deepEqual(regions('Remote (EU only)'), ['EU']);
    assert.deepEqual(regions('REMOTE: North America / Europe, UTC-8 to UTC+2'), ['NORTH_AMERICA', 'EUROPE']);
    assert.deepEqual(countries('Remote (Pacific-Eastern)'), []);
  });

  it('"(m/w/d)" is a German-market signal, not a country', () => {
    assert.deepEqual(parseLocation('Berlin (m/w/d)').countries, ['DE']);
    assert.deepEqual(parseLocation('Remote (m/w/d)').regions, ['DACH']);
    assert.deepEqual(parseLocation('Remote (w/m/d)').countries, []);
    assert.deepEqual(regions('Homeoffice (m/f/x)'), ['DACH']);
  });

  it('Cyrillic, transliteration and ISO spell the same country', () => {
    for (const text of ['Київ', 'Kyiv', 'kyiv', 'Kiev', 'Kyiv, UA', 'Київ, UA', 'Львів', 'Україна']) {
      assert.deepEqual(countries(text), ['UA'], text);
    }
    assert.deepEqual(countries('Europe; LATAM; Ukraine'), ['UA']);
    assert.deepEqual(regions('Europe; LATAM; Ukraine'), ['EUROPE', 'LATAM']);
    assert.equal(parseLocation('Київ, віддалено').workplace, 'REMOTE');
  });

  it('survives the whitespace and entities a feed leaves behind', () => {
    assert.deepEqual(countries('Kyiv, Ukraine'), ['UA']);
    assert.deepEqual(countries('Warsaw&nbsp;(remote)'), ['PL']);
    assert.deepEqual(countries('Berlin,  Germany  '), ['DE']);
  });

  it('never guesses a code for Jersey, Guernsey, the Isle of Man or Kosovo', () => {
    assert.deepEqual(countries('Jersey'), []);
    assert.deepEqual(countries('St Helier, Jersey'), []);
    assert.deepEqual(countries('Guernsey'), []);
    assert.deepEqual(countries('Isle of Man'), []);
    assert.deepEqual(countries('Pristina, Kosovo'), []);
    assert.deepEqual(countries('🇽🇰 Kosovo'), []);
    assert.deepEqual(countries('Jersey City, NJ'), ['US']);
  });

  it('a demonym counts only next to a residency word', () => {
    assert.deepEqual(countries('Poland or Romanian residents only'), ['RO', 'PL']);
    assert.deepEqual(countries('DUTCH REQUIRED'), []);
    assert.deepEqual(countries('German speaking'), []);
    assert.deepEqual(countries('EU citizens'), []);
  });
});

describe('parseLocation — flags, regions, spellings', () => {
  it('reads flags in any position, once each', () => {
    assert.deepEqual(countries('🇵🇱 Poland, 🇷🇴 Romania, 🇺🇦 Ukraine'), ['PL', 'RO', 'UA']);
    assert.deepEqual(countries('🇺🇸 United States of America'), ['US']);
  });

  it('reads region words and aggregator vocabularies', () => {
    assert.deepEqual(regions('Anywhere'), ['WORLDWIDE']);
    assert.deepEqual(regions('Anywhere in the World'), ['WORLDWIDE']);
    assert.deepEqual(regions('Remote, Global'), ['WORLDWIDE']);
    assert.deepEqual(regions('Remote, AMER'), ['AMERICAS']);
    assert.deepEqual(regions('Home based - EMEA'), ['EMEA']);
    assert.deepEqual(regions('REMOTE (NA/LATAM/EU)'), ['NORTH_AMERICA', 'LATAM', 'EU']);
    assert.deepEqual(parseLocation('USA, Canada, EMEA, LATAM').countries, ['US', 'CA']);
    assert.deepEqual(parseLocation('USA, Canada, EMEA, LATAM').regions, ['EMEA', 'LATAM']);
    assert.deepEqual(parseLocation('South Africa').countries, ['ZA']);
    assert.deepEqual(parseLocation('South Africa').regions, []);
    assert.deepEqual(parseLocation('South America').regions, ['LATAM']);
  });

  it('reads local spellings and the odd corners of the corpus', () => {
    assert.deepEqual(countries('Warszawa, Masovian Voivodeship, Poland'), ['PL']);
    assert.deepEqual(countries('Utrecht, The Netherlands'), ['NL']);
    assert.deepEqual(countries('Hybrid · Aarhus, Midtjylland, Denmark'), ['DK']);
    assert.deepEqual(countries('Toronto, Ontario, CAN - Remote'), ['CA']);
    assert.deepEqual(countries('Betterment HQ - New York City'), ['US']);
    assert.deepEqual(countries('SF, Athens, or US REMOTE'), ['US', 'GR']);
    assert.deepEqual(countries('Hybrid remote in Milwaukee, WI 53226'), ['US']);
    assert.deepEqual(countries('Remote (Deutschland)'), ['DE']);
    assert.deepEqual(countries('praca zdalna, Kraków'), ['PL']);
    assert.deepEqual(countries('Full-time'), []);
  });

  it('empty and unreadable strings find nothing', () => {
    assert.deepEqual(parseLocation(''), { workplace: 'UNKNOWN', countries: [], regions: [], source: null });
    assert.deepEqual(parseLocation('Full-time').source, null);
    assert.deepEqual(placesFromText('   '), { countries: [], regions: [] });
  });
});

describe('parseLocation — hints from the source', () => {
  it('hints come first and the text adds to them', () => {
    const p = parseLocation('New York, NY (remote)', { countries: ['gb'], workplace: 'HYBRID' });
    assert.deepEqual(p.countries, ['GB', 'US']);
    assert.equal(p.workplace, 'HYBRID');
    assert.equal(p.source, 'structured');
  });

  it('unknown codes, empty hints and UNKNOWN workplace count as no hint', () => {
    const p = parseLocation('Remote Poland', { countries: ['XK', ''], regions: ['MARS'], workplace: 'UNKNOWN' });
    assert.deepEqual(p, { workplace: 'REMOTE', countries: ['PL'], regions: [], source: 'parsed' });
  });

  it('a hint alone is structured even when the text says nothing', () => {
    assert.deepEqual(parseLocation('', { regions: ['WORLDWIDE'] }), {
      workplace: 'UNKNOWN',
      countries: [],
      regions: ['WORLDWIDE'],
      source: 'structured',
    });
  });
});
