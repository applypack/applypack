import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectorGroups, sectorLabels, sectorMatches } from './sectors';

// TASKS E6, issue #217: one resume read three times, three spellings of one career.
test('three spellings of the same sectors are one reading', () => {
  const runs = [
    ['e-commerce/fitness', 'adult entertainment/media', 'software consultancy', 'software services'],
    ['fitness/e-commerce', 'media/tech', 'software services', 'media'],
    ['e-commerce / fitness', 'media/tech', 'IT services', 'e-commerce'],
  ];
  const read = runs.map((sectors) => [...new Set(sectors.flatMap(sectorGroups))].sort());
  assert.deepEqual(read[0], ['IT services', 'e-commerce', 'fitness', 'media']);
  assert.deepEqual(read[1], read[0]);
  assert.deepEqual(read[2], read[0]);
});

test('the industry criterion matches by meaning, and only by meaning when it can', () => {
  assert.ok(sectorMatches('banking and payments', ['fintech', 'payments']));
  assert.ok(sectorMatches('Payments', ['payments technology / fintech']), 'case and plural');
  assert.ok(sectorMatches('online retail marketplace', ['e-commerce']));
  assert.ok(sectorMatches('health tech', ['healthcare']));
  assert.ok(!sectorMatches('software services', ['financial services']), 'a shared generic word is not a sector');
  assert.ok(!sectorMatches('hospitality', ['fintech']));
  assert.ok(!sectorMatches('machine learning research', ['education']), '"learning" alone is not edtech');
  assert.ok(!sectorMatches('new ventures studio', ['news media']), '"news" is not the plural of "new"');
  assert.deepEqual(sectorGroups('intellectual property law'), ['legal'], 'property here is not real estate');
  assert.ok(!sectorMatches(null, ['fintech']));
  // Outside the vocabulary a shared word still counts.
  assert.ok(sectorMatches('web design agency', ['web design agencies']));
  assert.ok(!sectorMatches('furniture design', ['web platforms']));
});

test('the career line names known sectors one way and keeps unknown ones as written', () => {
  assert.deepEqual(sectorLabels('adult entertainment / media'), ['media']);
  assert.deepEqual(sectorLabels('Payments, banking'), ['fintech']);
  assert.deepEqual(sectorLabels('CRM software'), ['SaaS']);
  assert.deepEqual(sectorLabels('assessments / surveys'), ['assessments / surveys']);
  assert.deepEqual(sectorLabels(null), []);
});
