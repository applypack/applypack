import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jobTechProbeUrl, jobTechSearchUrl, mapJobTechPage, parseJobTechTotal } from './jobtech';

// Trimmed from the live answer of 2026-09-03 (occupation-field=apaJ_2ja_LuF).
const trafikverket = {
  id: '31423675',
  headline: 'Systemutvecklare till framtidens transportsystem!',
  webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/31423675',
  publication_date: '2026-09-01T13:17:49',
  application_deadline: '2026-09-07T23:59:59',
  removed: false,
  employer: { name: 'Trafikverket', workplace: 'Trafikverket' },
  occupation: { concept_id: 'fg7B_yov_smw', label: 'Systemutvecklare/Programmerare' },
  employment_type: { label: 'Vanlig anställning' },
  working_hours_type: { label: 'Heltid' },
  salary_description: null,
  workplace_address: {
    municipality: 'Borlänge',
    region: 'Dalarnas län',
    country: 'Sverige',
    country_code: '199',
    street_address: 'Ort enligt annons',
  },
  workplace_model: { label: 'Arbete på plats' },
  description: { text: 'Hur utvecklar vi smarta IT-lösningar?\nArbetsuppgifter\nSom systemutvecklare hos oss …', text_formatted: '<p>…</p>' },
};

const page = (hits: unknown[], total = hits.length) => ({ total: { value: total }, hits });

describe('mapJobTechPage', () => {
  it('maps a hit: id, headline, municipality + region + Sweden from the taxonomy code, the head lines, plain text kept', () => {
    const { jobs, full } = mapJobTechPage(page([trafikverket]), 3);
    assert.equal(full, false);
    assert.equal(jobs.length, 1);
    const [job] = jobs;
    assert.equal(job?.externalId, '31423675');
    assert.equal(job?.title, 'Systemutvecklare till framtidens transportsystem!');
    assert.equal(job?.url, 'https://arbetsformedlingen.se/platsbanken/annonser/31423675');
    assert.equal(job?.location, 'Borlänge, Dalarnas län, Sweden');
    assert.deepEqual(job?.locationHints, { countries: ['SE'] });
    assert.equal(job?.postedAt.toISOString(), '2026-09-01T13:17:49.000Z');
    assert.equal(
      job?.description,
      'Hiring company: Trafikverket. Occupation: Systemutvecklare/Programmerare. Employment: Vanlig anställning, Heltid. Apply by: 2026-09-07.\n\nHur utvecklar vi smarta IT-lösningar?\nArbetsuppgifter\nSom systemutvecklare hos oss …',
    );
  });

  it('reads a foreign ad by its country name, skips removed ads and malformed hits', () => {
    const spain = { ...trafikverket, id: 2, workplace_address: { municipality: null, region: null, country: 'Spanien', country_code: '193' } };
    const gone = { ...trafikverket, id: 3, removed: true };
    const { jobs, full } = mapJobTechPage(page([spain, gone, { headline: 'no id' }], 771), 3);
    assert.deepEqual(jobs.map((j) => j.externalId), ['2']);
    assert.equal(jobs[0]?.location, 'Spanien');
    assert.deepEqual(jobs[0]?.locationHints, {});
    assert.equal(full, false);
    assert.equal(mapJobTechPage(page(Array.from({ length: 100 }, (_, i) => ({ ...trafikverket, id: i })), 771), 3).full, true);
    assert.deepEqual(mapJobTechPage({ results: [] }, 3), { jobs: [], full: false });
  });
});

describe('jobTechSearchUrl / jobTechProbeUrl / parseJobTechTotal', () => {
  it('keeps the token\'s known filters and adds the window, the sort and the page', () => {
    assert.equal(
      jobTechSearchUrl('occupation-field=apaJ_2ja_LuF&published-after=1&limit=5&evil=1', 200),
      'https://jobsearch.api.jobtechdev.se/search?occupation-field=apaJ_2ja_LuF&published-after=1440&sort=pubdate-desc&limit=100&offset=200',
    );
    assert.equal(jobTechSearchUrl('?q=php&remote=true'), 'https://jobsearch.api.jobtechdev.se/search?q=php&remote=true&published-after=1440&sort=pubdate-desc&limit=100&offset=0');
    assert.equal(jobTechProbeUrl('q=php'), 'https://jobsearch.api.jobtechdev.se/search?q=php&limit=1');
  });

  it('reads the total of an answer and 0 of anything else', () => {
    assert.equal(parseJobTechTotal({ total: { value: 771 }, hits: [] }), 771);
    assert.equal(parseJobTechTotal({ message: 'bad request' }), 0);
  });
});
