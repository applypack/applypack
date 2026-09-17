import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOP_PLACES,
  UNKNOWN_PLACE,
  activeFilters,
  clearFiltersHref,
  filterCount,
  jobsHref,
  parsePlaces,
  parsePosted,
  parseWorkplaces,
  placeWhere,
  postedSince,
  rowPlaces,
  splitPlaces,
  tallyFacets,
  toggled,
  type FacetRow,
  type JobsFilters,
} from './job-facets';

const NOW = new Date('2026-09-03T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

const rows: FacetRow[] = [
  { countries: ['PL'], regions: [], workplace: 'REMOTE', postedAt: daysAgo(0.5) },
  { countries: ['PL', 'DE'], regions: [], workplace: 'HYBRID', postedAt: daysAgo(3) },
  { countries: [], regions: ['EU'], workplace: 'REMOTE', postedAt: daysAgo(10) },
  { countries: [], regions: [], workplace: 'REMOTE', postedAt: daysAgo(40) },
  { countries: ['US'], regions: [], workplace: 'UNKNOWN', postedAt: daysAgo(1) },
];

describe('query parsing', () => {
  it('keeps known country and region codes and "unknown", once each, uppercased', () => {
    assert.deepEqual(parsePlaces('pl, DE,EUROPE,unknown,XX,,pl'), ['PL', 'DE', 'EUROPE', UNKNOWN_PLACE]);
    assert.deepEqual(parsePlaces(undefined), []);
  });

  it('keeps enum workplaces only', () => {
    assert.deepEqual(parseWorkplaces('remote,Hybrid,office,remote'), ['REMOTE', 'HYBRID']);
  });

  it('keeps a known posted window only', () => {
    assert.equal(parsePosted('7d'), '7d');
    assert.equal(parsePosted('2y'), '');
    assert.equal(parsePosted(undefined), '');
  });
});

describe('where-clauses', () => {
  it('ORs countries, regions and the unknown bucket', () => {
    assert.deepEqual(placeWhere(['PL', 'DE', 'EU', UNKNOWN_PLACE]), {
      OR: [
        { countries: { hasSome: ['PL', 'DE'] } },
        { regions: { hasSome: ['EU'] } },
        { countries: { isEmpty: true }, regions: { isEmpty: true } },
      ],
    });
    assert.equal(placeWhere([]), null);
  });

  it('turns a window into a since-date', () => {
    assert.deepEqual(postedSince('7d', NOW), daysAgo(7));
    assert.equal(postedSince('', NOW), null);
  });
});

describe('tallyFacets', () => {
  it('counts each row under every place it names, or under unknown', () => {
    const { places } = tallyFacets(rows, { places: [], workplaces: [], posted: '' }, NOW);
    assert.deepEqual(
      places.map((c) => [c.value, c.count]),
      [['PL', 2], ['EU', 1], ['DE', 1], ['US', 1], [UNKNOWN_PLACE, 1]],
    );
    assert.equal(places[0]?.label, 'Poland');
    assert.equal(places[0]?.flag, '🇵🇱');
    assert.equal(places.find((c) => c.value === 'EU')?.label, 'European Union');
    assert.equal(places.find((c) => c.value === UNKNOWN_PLACE)?.label, 'Unknown');
  });

  it('a facet ignores its own selection and respects the other', () => {
    const chips = tallyFacets(rows, { places: ['PL'], workplaces: ['REMOTE'], posted: '' }, NOW);
    // Places: remote rows only — PL 1, EU 1, unknown 1; DE is hybrid and drops out.
    assert.deepEqual(chips.places.map((c) => [c.value, c.count, c.selected]), [
      ['EU', 1, false],
      ['PL', 1, true],
      [UNKNOWN_PLACE, 1, false],
    ]);
    // Workplaces: PL rows only — one remote, one hybrid.
    assert.deepEqual(chips.workplaces.map((c) => [c.value, c.count, c.selected]), [
      ['remote', 1, true],
      ['hybrid', 1, false],
      ['onsite', 0, false],
      ['unknown', 0, false],
    ]);
    // Posted: PL + remote → the one row from half a day ago.
    assert.deepEqual(chips.posted.map((c) => [c.value, c.count]), [['24h', 1], ['7d', 1], ['30d', 1]]);
  });

  it('a posted window narrows the other two facets but not itself', () => {
    const chips = tallyFacets(rows, { places: [], workplaces: [], posted: '7d' }, NOW);
    assert.deepEqual(chips.places.map((c) => [c.value, c.count]), [['PL', 2], ['DE', 1], ['US', 1]]);
    assert.deepEqual(chips.workplaces.map((c) => [c.value, c.count]), [['remote', 1], ['hybrid', 1], ['onsite', 0], ['unknown', 1]]);
    assert.deepEqual(chips.posted.map((c) => [c.value, c.count, c.selected]), [['24h', 2, false], ['7d', 3, true], ['30d', 4, false]]);
  });

  it('posted windows are cumulative', () => {
    const { posted } = tallyFacets(rows, { places: [], workplaces: [], posted: '' }, NOW);
    assert.deepEqual(posted.map((c) => [c.value, c.count]), [['24h', 2], ['7d', 3], ['30d', 4]]);
  });
});

describe('chip helpers', () => {
  it('a row with nothing counts as unknown', () => {
    assert.deepEqual(rowPlaces({ countries: [], regions: [] }), [UNKNOWN_PLACE]);
    assert.deepEqual(rowPlaces({ countries: ['PL'], regions: ['EU'] }), ['PL', 'EU']);
  });

  it('shows the busiest chips plus every selected one', () => {
    const chips = Array.from({ length: TOP_PLACES + 3 }, (_, i) => ({
      value: `C${i}`,
      label: `C${i}`,
      flag: '',
      count: 100 - i,
      selected: i === TOP_PLACES + 2,
    }));
    const { shown, more } = splitPlaces(chips);
    assert.equal(shown.length, TOP_PLACES + 1);
    assert.equal(shown.at(-1)?.value, `C${TOP_PLACES + 2}`);
    assert.equal(more.length, 2);
  });

  it('toggles a value in and out of a selection', () => {
    assert.deepEqual(toggled(['PL'], 'DE'), ['PL', 'DE']);
    assert.deepEqual(toggled(['PL', 'DE'], 'PL'), ['DE']);
  });
});

const NONE: JobsFilters = {
  status: '',
  minFit: '',
  q: '',
  sort: 'fetchedAt_desc',
  verified: '',
  watched: '',
  open: '',
  profile: null,
  country: [],
  workplace: [],
  posted: '',
};
const query = (href: string) => Object.fromEntries(new URL(href, 'http://x').searchParams);

describe('jobsHref', () => {
  it('leaves empty values and page 1 out', () => {
    assert.equal(jobsHref({ ...NONE, sort: '' }), '/jobs');
    assert.deepEqual(query(jobsHref(NONE)), { sort: 'fetchedAt_desc' });
    assert.deepEqual(query(jobsHref(NONE, { page: 1 })), { sort: 'fetchedAt_desc' });
    assert.equal(query(jobsHref(NONE, { page: 3 })).page, '3');
  });

  it('joins multi-value facets with commas, as the route reads them', () => {
    const q = query(jobsHref({ ...NONE, country: ['US', 'EU', 'unknown'], workplace: ['remote', 'hybrid'], profile: 7 }));
    assert.equal(q.country, 'US,EU,unknown');
    assert.equal(q.workplace, 'remote,hybrid');
    assert.equal(q.profile, '7');
    assert.deepEqual(parsePlaces(q.country), ['US', 'EU', UNKNOWN_PLACE]);
  });

  it('carries panel=1 only when asked', () => {
    assert.equal(query(jobsHref(NONE)).panel, undefined);
    assert.equal(query(jobsHref({ ...NONE, posted: '7d' }, { panel: true })).panel, '1');
  });
});

describe('the active-filter row', () => {
  const ALL: JobsFilters = {
    ...NONE,
    status: 'ALERTED',
    minFit: '70',
    q: 'php',
    profile: 2,
    country: ['US', 'unknown'],
    workplace: ['remote', 'unknown'],
    posted: '7d',
    verified: '1',
    watched: '1',
    open: '1',
  };
  const profiles = [{ id: 2, name: 'Laravel remote' }];

  it('lists one entry per panel value, in the panel order, with flags on places', () => {
    const rows = activeFilters(ALL, profiles);
    assert.deepEqual(
      rows.map((f) => f.label),
      ['Search: Laravel remote', 'United States', 'Place unknown', 'Remote', 'Workplace unknown', 'Posted: last 7 days', 'Verified', '★ Watched', 'Open to me'],
    );
    assert.equal(rows[1]?.flag, '🇺🇸');
    assert.equal(rows[2]?.flag, '');
  });

  it('each link lifts its own value and nothing else', () => {
    const rows = activeFilters(ALL, profiles);
    const byLabel = (label: string) => query(rows.find((f) => f.label === label)?.href ?? '');
    assert.equal(byLabel('United States').country, 'unknown');
    assert.equal(byLabel('Place unknown').country, 'US');
    assert.equal(byLabel('Remote').workplace, 'unknown');
    assert.equal(byLabel('Search: Laravel remote').profile, undefined);
    assert.equal(byLabel('Posted: last 7 days').posted, undefined);
    assert.equal(byLabel('Verified').verified, undefined);
    for (const f of rows) {
      const q = query(f.href);
      assert.equal(q.status, 'ALERTED');
      assert.equal(q.q, 'php');
      assert.equal(q.minFit, '70');
      assert.equal(q.panel, undefined);
      assert.equal(q.page, undefined);
    }
    assert.equal(byLabel('Verified').watched, '1');
  });

  it('still offers a way out of a search that is no longer running', () => {
    assert.deepEqual(activeFilters({ ...NONE, profile: 9 }, profiles).map((f) => f.label), ['Search: #9']);
  });

  it('counts what the panel holds, not the controls in plain sight', () => {
    assert.equal(filterCount(NONE), 0);
    assert.equal(filterCount({ ...NONE, status: 'NEW', q: 'php', minFit: '70', sort: 'title_asc' }), 0);
    assert.equal(filterCount(ALL), activeFilters(ALL, profiles).length);
    assert.equal(filterCount(ALL), 9);
  });

  it('clear-all lifts the panel and keeps status, search text, fit floor and sort', () => {
    assert.deepEqual(query(clearFiltersHref(ALL)), { status: 'ALERTED', minFit: '70', q: 'php', sort: 'fetchedAt_desc' });
  });
});
