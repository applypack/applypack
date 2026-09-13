import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postingOrientation } from './posting-orientation';

/** Job 71's stored brief, as the model wrote it (posting_brief row 7). */
const CUMULUS = {
  role: {
    posted_title: 'Senior Software Engineer',
    family: 'backend web application development',
    seniority: 'senior',
    years_min: 5,
    focus: 'Design, build, and maintain PHP/Laravel-based digital commerce platforms, APIs, and integrations while providing technical leadership and architecture direction.',
  },
  company: {
    industry: 'audio/media broadcasting',
    product:
      'digital commerce platforms (Sweet Deals, affiliate marketplaces, auctions) and internal administration systems supporting a national radio/podcast/advertising business',
    audience: 'internal business stakeholders, advertisers, and consumers of promotional/marketplace platforms',
    stage: 'enterprise',
  },
  screening: {
    reader: 'in-house HR/recruiter screening for PHP/Laravel technical leadership, per title and stack detail',
    scan_for: ['PHP and Laravel framework depth', 'REST API design and consumption experience'],
    wow: [],
    dealbreakers: [],
  },
};

const blank = {
  role: { posted_title: '', family: '', seniority: null, years_min: null, focus: '' },
  company: { industry: null, product: null, audience: null, stage: null },
  screening: { reader: '', scan_for: [], wow: [], dealbreakers: [] },
};

test('a real brief orients in three lines: sector, product, first reader', () => {
  const rows = postingOrientation(CUMULUS);
  assert.deepEqual(rows.map((r) => r.label), ['Sector', 'The product', 'Read first by']);
  assert.equal(rows[0]?.text, 'audio/media broadcasting · enterprise');
  assert.equal(
    rows[2]?.text,
    'in-house HR/recruiter screening for PHP/Laravel technical leadership, per title and stack detail',
  );
});

test('a product longer than the row is cut on a word boundary, never mid-word', () => {
  const product = postingOrientation(CUMULUS)[1]!.text;
  assert.ok(product.length <= 131, `row is ${product.length} chars`);
  assert.ok(product.endsWith('…'));
  assert.ok(
    CUMULUS.company.product.startsWith(product.slice(0, -1)),
    'what is kept is a prefix of what the brief wrote',
  );
});

test('the stage is dropped when the industry already says it', () => {
  const rows = postingOrientation({
    ...CUMULUS,
    company: { ...CUMULUS.company, industry: 'software house / digital agency', stage: 'agency' },
  });
  assert.equal(rows[0]?.text, 'software house / digital agency');
});

test('the role focus stands in when the brief named no product', () => {
  const rows = postingOrientation({ ...CUMULUS, company: { ...CUMULUS.company, product: null } });
  assert.deepEqual(rows.map((r) => r.label), ['Sector', 'The work', 'Read first by']);
  assert.ok(rows[1]?.text.startsWith('Design, build, and maintain PHP/Laravel-based'));
});

test('a field the brief left empty produces no line, and an empty brief produces nothing', () => {
  assert.deepEqual(postingOrientation(blank), []);
  assert.deepEqual(postingOrientation(null), []);
  assert.deepEqual(postingOrientation(undefined), []);
  const sectorOnly = postingOrientation({ ...blank, company: { ...blank.company, industry: 'online gambling' } });
  assert.deepEqual(sectorOnly, [{ label: 'Sector', text: 'online gambling' }]);
});
