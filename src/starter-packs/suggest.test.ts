import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestSources, type SuggestSearch } from './suggest';

const php: SuggestSearch = {
  name: 'PHP/Laravel',
  countries: ['UA'],
  regions: ['EU'],
  workplace: ['REMOTE'],
  stackRequired: ['php', 'laravel', 'mysql'],
};

describe('suggestSources', () => {
  it('offers DOU and Djinni rows for a search that names Ukraine, from its stack', () => {
    const out = suggestSources([php], []);
    assert.deepEqual(
      out.map((s) => [s.atsType, s.atsToken, s.name, s.state]),
      [
        ['DOU', 'category=PHP&remote', 'DOU · PHP, remote', 'missing'],
        ['DJINNI', 'primary_keyword=PHP&employment=remote&region=UKR', 'Djinni · PHP, remote, Ukraine', 'missing'],
        ['DJINNI', 'primary_keyword=Laravel&employment=remote&region=UKR', 'Djinni · Laravel, remote, Ukraine', 'missing'],
      ],
    );
    assert.equal(out[0]?.reason, '🇺🇦 Ukraine in "PHP/Laravel"');
    assert.equal(out[0]?.careerUrl, 'https://jobs.dou.ua/vacancies/?category=PHP&remote');
  });

  it('drops the remote filters for an office-only search and caps the feeds per search', () => {
    const office = { ...php, workplace: ['ONSITE' as const], stackRequired: ['php', 'javascript', 'python', 'java', 'go'] };
    const out = suggestSources([office], []);
    assert.deepEqual(out.filter((s) => s.atsType === 'DOU').map((s) => s.atsToken), ['category=PHP', 'category=JavaScript', 'category=Python']);
    assert.deepEqual(out.filter((s) => s.atsType === 'DJINNI').map((s) => s.atsToken), [
      'primary_keyword=PHP&region=UKR',
      'primary_keyword=JavaScript&region=UKR',
      'primary_keyword=Python&region=UKR',
    ]);
  });

  it('reads the state from the rows already tracked', () => {
    const out = suggestSources([php], [
      { id: 7, atsType: 'DOU', atsToken: 'category=PHP&remote', active: false },
      { id: 8, atsType: 'DJINNI', atsToken: 'primary_keyword=PHP&employment=remote&region=UKR', active: true },
    ]);
    assert.deepEqual(out.map((s) => [s.state, s.companyId]), [['off', 7], ['on', 8], ['missing', null]]);
  });

  it('offers solid.jobs for a search that names Poland or the CEE group', () => {
    assert.deepEqual(
      suggestSources([{ ...php, countries: ['PL'], regions: [] }], [])
        .filter((s) => s.atsType !== 'ADZUNA')
        .map((s) => [s.atsType, s.atsToken, s.reason]),
      [['SOLIDJOBS', 'solidjobs', '🇵🇱 Poland in "PHP/Laravel"']],
    );
    assert.equal(suggestSources([{ ...php, countries: [], regions: ['CEE'] }], []).filter((s) => s.atsType === 'SOLIDJOBS').length, 1);
  });

  it('offers the two Arbeitnow rows for German-speaking and British searches', () => {
    const de = { ...php, countries: ['DE'], regions: [], stackRequired: ['java'] };
    const out = suggestSources([de], [{ id: 3, atsType: 'ARBEITNOW', atsToken: 'arbeitnow', active: false }]);
    assert.deepEqual(out.filter((s) => s.atsType !== 'ADZUNA').map((s) => [s.atsType, s.atsToken, s.state]), [
      ['DEVITJOBS', 'germantechjobs.de', 'missing'],
      ['ARBEITNOW', 'arbeitnow', 'off'],
      ['ARBEITNOW', 'visa', 'missing'],
    ]);
    // A group names no single market, so DACH alone gets no Adzuna row.
    assert.equal(suggestSources([{ ...de, countries: [], regions: ['DACH'] }], []).length, 3);
    assert.equal(suggestSources([{ ...de, countries: ['AR'], regions: ['EU'] }], []).length, 0);
  });

  it('offers Landing.jobs for a search that names Portugal', () => {
    assert.deepEqual(
      suggestSources([{ ...php, countries: ['PT'], regions: [] }], []).map((s) => [s.atsType, s.atsToken, s.reason]),
      [['LANDINGJOBS', 'landingjobs', '🇵🇹 Portugal in "PHP/Laravel"']],
    );
    assert.equal(suggestSources([{ ...php, countries: ['AR'], regions: ['EU'] }], []).length, 0);
  });

  it('offers the JobTech Data/IT row for a search that names Sweden or the Nordics', () => {
    assert.deepEqual(
      suggestSources([{ ...php, countries: ['SE'], regions: [] }], []).map((s) => [s.atsType, s.atsToken, s.reason]),
      [['JOBTECH', 'occupation-field=apaJ_2ja_LuF', '🇸🇪 Sweden in "PHP/Laravel"']],
    );
    assert.equal(suggestSources([{ ...php, countries: [], regions: ['NORDICS'] }], []).length, 1);
  });

  it('offers an Adzuna row for every market a search names, and none for a country Adzuna does not serve', () => {
    const out = suggestSources([{ ...php, countries: ['DE', 'UA', 'PL'], regions: [] }], [
      { id: 9, atsType: 'ADZUNA', atsToken: 'pl', active: true },
    ]);
    const adzuna = out.filter((s) => s.atsType === 'ADZUNA');
    assert.deepEqual(adzuna.map((s) => [s.atsToken, s.name, s.state]), [
      ['de', 'Adzuna · Germany', 'missing'],
      ['pl', 'Adzuna · Poland', 'on'],
    ]);
    assert.equal(adzuna[0]?.reason, '🇩🇪 Germany in "PHP/Laravel" — needs your Adzuna key');
    assert.equal(adzuna[0]?.careerUrl, 'https://www.adzuna.de/');
  });

  it('offers the France Travail developer row for a search that names France', () => {
    const fr = suggestSources([{ ...php, countries: ['FR'], regions: [] }], []).filter((s) => s.atsType === 'FRANCETRAVAIL');
    assert.deepEqual(fr.map((s) => [s.atsToken, s.state]), [['codeROME=M1805', 'missing']]);
    assert.match(fr[0]?.reason ?? '', /needs your France Travail client id and secret/);
  });

  it('offers the DevITjobs site of the country a search names', () => {
    const uk = suggestSources([{ ...php, countries: ['GB'], regions: [] }], []);
    assert.deepEqual(uk.map((s) => [s.atsType, s.atsToken, s.reason]).filter((r) => r[0] === 'DEVITJOBS'), [
      ['DEVITJOBS', 'devitjobs.uk', '🇬🇧 the UK in "PHP/Laravel"'],
    ]);
    const nl = suggestSources([{ ...php, countries: [], regions: ['BENELUX'] }], []);
    assert.deepEqual(nl.map((s) => s.atsToken), ['devitjobs.nl']);
  });

  it('says nothing for a search with no matching place, and merges two searches without duplicates', () => {
    assert.deepEqual(suggestSources([{ ...php, countries: ['AR'], regions: [] }], []), []);
    assert.deepEqual(suggestSources([{ ...php, countries: ['US'], regions: [] }], []).map((s) => s.atsToken), ['us']);
    const two = suggestSources([php, { ...php, name: 'Second', stackRequired: ['php'] }], []);
    assert.equal(two.filter((s) => s.atsToken === 'category=PHP&remote').length, 1);
  });

  it('a stack with no known feed name offers nothing for that source', () => {
    const out = suggestSources([{ ...php, stackRequired: ['cobol'] }], []);
    assert.deepEqual(out, []);
  });
});
