import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOP_PLACES,
  UNKNOWN_PLACE,
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
