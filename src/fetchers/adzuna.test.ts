import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADZUNA_MARKETS, adzunaCodeFor, adzunaCount, adzunaDue, adzunaMarket, adzunaSearchUrl, mapAdzunaPage } from './adzuna';

// The vendor's documented sample (developer.adzuna.com/docs/search), trimmed.
const page = {
  __CLASS__: 'Adzuna::API::Response::JobSearchResults',
  count: 1731,
  results: [
    {
      salary_min: 50000,
      longitude: -0.776902,
      location: { __CLASS__: 'Adzuna::API::Response::Location', area: ['UK', 'South East England', 'Buckinghamshire', 'Marlow'], display_name: 'Marlow, Buckinghamshire' },
      salary_is_predicted: 0,
      description: 'JavaScript Developer Corporate ...',
      __CLASS__: 'Adzuna::API::Response::Job',
      created: '2013-11-08T18:07:39Z',
      latitude: 51.571999,
      redirect_url: 'http://adzuna.co.uk/jobs/land/ad/129698749?v=…&utm_medium=api&utm_source=6eda9a47',
      title: 'Javascript Developer',
      category: { __CLASS__: 'Adzuna::API::Response::Category', label: 'IT Jobs', tag: 'it-jobs' },
      id: '129698749',
      salary_max: 55000,
      company: { __CLASS__: 'Adzuna::API::Response::Company', display_name: 'Corporate Project Solutions' },
      contract_type: 'permanent',
    },
    {
      id: 126977586,
      title: ' Senior Developer Python ',
      redirect_url: 'http://adzuna.co.uk/jobs/land/ad/126977586',
      location: { display_name: 'The City, Central London' },
      salary_min: 55000,
      salary_max: 55000,
      salary_is_predicted: '1',
      contract_time: 'full_time',
      created: '2013-10-23T19:32:43Z',
    },
    { title: 'no id', redirect_url: 'x' },
  ],
};

describe('mapAdzunaPage', () => {
  it('maps an ad: id, the landing link as the URL, the market as the country, salary and contract in the head, the snippet note', () => {
    const jobs = mapAdzunaPage(page, 3, ADZUNA_MARKETS.gb!);
    assert.equal(jobs.length, 2);
    const [js, py] = jobs;
    assert.equal(js?.externalId, '129698749');
    assert.equal(js?.title, 'Javascript Developer');
    assert.equal(js?.url, 'http://adzuna.co.uk/jobs/land/ad/129698749?v=…&utm_medium=api&utm_source=6eda9a47');
    assert.equal(js?.location, 'Marlow, Buckinghamshire, United Kingdom');
    assert.deepEqual(js?.locationHints, { countries: ['GB'] });
    assert.equal(js?.postedAt.toISOString(), '2013-11-08T18:07:39.000Z');
    assert.equal(
      js?.description,
      'Hiring company: Corporate Project Solutions. Contract: permanent. Salary: 50000-55000 GBP (year).\n\nJavaScript Developer Corporate ...\n\nSnippet only (Jobs by Adzuna) — the full posting is behind the apply link.',
    );
    assert.equal(py?.externalId, '126977586');
    assert.equal(py?.title, 'Senior Developer Python');
    assert.match(py?.description ?? '', /^Contract: full time\. Salary: 55000 GBP \(year, Adzuna estimate\)\.\n\nSnippet only/);
  });

  it('answers nothing for a payload that is not a search result', () => {
    assert.deepEqual(mapAdzunaPage({ error: 'AUTH_FAIL' }, 3, ADZUNA_MARKETS.de!), []);
    assert.equal(adzunaCount(page), 1731);
    assert.equal(adzunaCount({ results: [{}, {}] }), 2);
    assert.equal(adzunaCount({ exception: 'x' }), null);
  });
});

describe('markets, cadence and the URL', () => {
  it('knows the markets by code and by country, and refuses the rest', () => {
    assert.equal(adzunaMarket(' DE ').market.domain, 'www.adzuna.de');
    assert.equal(adzunaMarket('gb').market.currency, 'GBP');
    assert.equal(adzunaCodeFor('PL'), 'pl');
    assert.equal(adzunaCodeFor('UA'), null);
    assert.throws(() => adzunaMarket('uk'), /not a market code/);
  });

  it('polls four times a day by the UTC hour', () => {
    assert.equal(adzunaDue(new Date('2026-09-04T06:07:00Z')), true);
    assert.equal(adzunaDue(new Date('2026-09-04T07:00:00Z')), false);
    assert.equal(adzunaDue(new Date('2026-09-04T00:59:00Z')), true);
  });

  it('builds the search URL the terms allow: the IT category, the last day, newest first, 50 per page', () => {
    assert.equal(
      adzunaSearchUrl('de', { app_id: 'id1', app_key: 'k/2' }),
      'https://api.adzuna.com/v1/api/jobs/de/search/1?app_id=id1&app_key=k%2F2&results_per_page=50&max_days_old=1&sort_by=date&category=it-jobs&content-type=application%2Fjson',
    );
  });
});
