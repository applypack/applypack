import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileLine } from './profile-line';

const base = { roleTypes: [], stackRequired: [], workplace: [], countries: [], regions: [], minFitScore: 70 };

test('a full search reads as roles, skills, place and fit', () => {
  const line = profileLine({
    ...base,
    roleTypes: ['Backend', 'Full stack'],
    stackRequired: ['PHP', 'Laravel', 'TypeScript'],
    workplace: ['REMOTE'],
    countries: ['US'],
  });
  assert.equal(line.roles, 'Backend, Full stack');
  assert.equal(line.skills, 'PHP, Laravel, TypeScript');
  assert.match(line.place, /^Remote · United States/);
  assert.equal(line.fit, 'min. fit 70');
});

test('a long list keeps its head and counts the rest', () => {
  const line = profileLine({ ...base, roleTypes: ['Backend', 'Full stack', 'Platform'], stackRequired: ['PHP', 'Laravel', 'Vue', 'MySQL', 'Docker'] });
  assert.equal(line.roles, 'Backend, Full stack +1');
  assert.equal(line.skills, 'PHP, Laravel, Vue +2');
});

test('an empty search says anywhere and names nothing it does not have', () => {
  const line = profileLine(base);
  assert.equal(line.roles, null);
  assert.equal(line.skills, null);
  assert.equal(line.place, 'Anywhere');
});

test('arrangements without places, and places with groups', () => {
  assert.equal(profileLine({ ...base, workplace: ['REMOTE', 'HYBRID'] }).place, 'Remote / Hybrid · Anywhere');
  assert.match(profileLine({ ...base, countries: ['PL', 'DE'], regions: ['EU'] }).place, /\+1$/);
});
