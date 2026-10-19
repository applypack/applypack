import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ResumeSummary } from '../resume/store';
import { distinctName, newProfileDraft } from './profile-from-resume';

const scanned = {
  name: 'marta v2',
  title: 'Senior Backend Engineer',
  seniority: 'senior',
  skills: ['Node.js', 'PostgreSQL'],
  primarySkills: ['Node.js'],
  roleTypes: ['backend'],
} as unknown as ResumeSummary;

test('#589: a search drafted from another resume names that resume when its title is taken', () => {
  assert.equal(newProfileDraft(scanned, []).changes.name, 'Senior Backend Engineer');
  assert.equal(newProfileDraft(scanned, ['Senior Backend Engineer']).changes.name, 'Senior Backend Engineer — marta v2');
});

test('a name nobody has stays as it is, and a long one still fits the editor', () => {
  assert.equal(distinctName('Data Engineer', 'marta v2', ['Senior Backend Engineer']), 'Data Engineer');
  // The resume's own name says nothing more about itself.
  assert.equal(distinctName('marta v2', 'marta v2', ['marta v2']), 'marta v2');
  assert.equal(Array.from(distinctName('x'.repeat(90), 'y'.repeat(30), ['x'.repeat(90)])).length, 100);
});
