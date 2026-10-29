import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG,
  companiesInSegments,
  countsBySegment,
  findCompany,
  segments,
} from './catalog';
import { RESOLVE_ORDER, keyOf } from './resolve';

test('every company points at a declared segment', () => {
  const ids = new Set(segments().map((s) => s.id));
  for (const c of CATALOG.companies) {
    assert.ok(ids.has(c.segment), `${c.name} has unknown segment "${c.segment}"`);
  }
});

test('every segment is non-empty', () => {
  const counts = countsBySegment();
  for (const s of segments()) {
    assert.ok((counts.get(s.id) ?? 0) > 0, `segment "${s.id}" has no companies`);
  }
});

test('no board is listed twice', () => {
  const seen = new Set<string>();
  for (const c of CATALOG.companies) {
    const key = keyOf(c.atsType, c.atsToken);
    assert.ok(!seen.has(key), `${key} appears twice (${c.name})`);
    seen.add(key);
  }
});

test('no company name repeats inside a segment', () => {
  const seen = new Set<string>();
  for (const c of CATALOG.companies) {
    const key = `${c.segment}:${c.name}`;
    assert.ok(!seen.has(key), `${key} appears twice`);
    seen.add(key);
  }
});

test('every pinned board uses a per-company vendor we can probe', () => {
  for (const c of CATALOG.companies) {
    assert.ok(
      RESOLVE_ORDER.includes(c.atsType),
      `${c.name} pins ${c.atsType}, which the resolver cannot probe`,
    );
  }
});

test('no field contains the "|" the confirm form splits on', () => {
  for (const c of CATALOG.companies) {
    for (const field of [c.name, c.segment, c.atsType, c.atsToken]) {
      assert.ok(!field.includes('|'), `"${field}" would break the pick value`);
    }
  }
});

test('companiesInSegments filters by segment and ignores unknown ids', () => {
  const first = segments()[0];
  assert.ok(first);
  const picked = companiesInSegments([first.id, 'no-such-segment']);
  assert.equal(picked.length, countsBySegment().get(first.id));
  assert.ok(picked.every((c) => c.segment === first.id));
  assert.deepEqual(companiesInSegments([]), []);
});

test('findCompany matches on the (segment, name) pair the form round-trips', () => {
  const sample = CATALOG.companies[0];
  assert.ok(sample);
  assert.deepEqual(findCompany(sample.segment, sample.name), sample);
  assert.equal(findCompany('no-such-segment', sample.name), null);
  assert.equal(findCompany(sample.segment, 'No Such Company'), null);
});

test('the boards the companies left stay out of the catalog (#638)', () => {
  // Re-checked 2026-10-29 against each company's careers page: Postman hires
  // on Workday, Remote on its own site, Skylum on PeopleForce, Stytch's
  // careers page redirects to Twilio's, MacPaw's Recruitee API answers 403,
  // and Webflow, Amplitude and Lemon.io moved to the Ashby boards now pinned.
  const left = [
    'GREENHOUSE:postman',
    'GREENHOUSE:remotecom',
    'BAMBOOHR:skylum',
    'ASHBY:stytch',
    'RECRUITEE:macpaw',
    'GREENHOUSE:webflow',
    'GREENHOUSE:amplitude',
    'BAMBOOHR:lemonio',
  ];
  const pinned = new Set(CATALOG.companies.map((c) => keyOf(c.atsType, c.atsToken)));
  for (const key of left) assert.ok(!pinned.has(key), `${key} is pinned again`);
});
