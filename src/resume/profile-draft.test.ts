import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileDraft, type ProfileForDraft, type ScanForDraft } from './profile-draft';

const PROFILE: ProfileForDraft = {
  name: 'PHP hunt',
  stackRequired: ['php', 'laravel'],
  stackNiceToHave: ['mysql'],
  roleTypes: ['backend'],
  seniority: ['senior'],
};

const SCAN: ScanForDraft = {
  title: 'Senior Full-Stack Engineer',
  seniority: 'senior',
  skills: ['php', 'laravel', 'vue', 'mysql', 'docker'],
  primarySkills: ['php', 'laravel', 'vue'],
  roleTypes: ['full-stack', 'backend'],
};

test('maps primary skills to required, the rest to nice-to-have', () => {
  const d = buildProfileDraft(PROFILE, SCAN);
  assert.deepEqual(d.changes.stackRequired, ['php', 'laravel', 'vue']);
  assert.deepEqual(d.changes.stackNiceToHave, ['mysql', 'docker']);
  assert.deepEqual(d.changes.roleTypes, ['full-stack', 'backend']);
  assert.equal(d.changes.seniority, undefined); // senior already set
  assert.deepEqual(d.changed, ['required stack', 'nice-to-have stack', 'role types']);
  assert.deepEqual(d.warnings, []);
});

test('renames only the freshly created profile', () => {
  const kept = buildProfileDraft(PROFILE, SCAN);
  assert.equal(kept.changes.name, undefined);
  const fresh = buildProfileDraft({ ...PROFILE, name: 'New profile' }, SCAN);
  assert.equal(fresh.changes.name, 'Senior Full-Stack Engineer');
  const boot = buildProfileDraft({ ...PROFILE, name: 'My profile' }, SCAN);
  assert.equal(boot.changes.name, 'Senior Full-Stack Engineer');
});

test('empty primary stack keeps the required stack and warns', () => {
  const d = buildProfileDraft(PROFILE, { ...SCAN, primarySkills: [] });
  assert.equal(d.changes.stackRequired, undefined);
  // Nice-to-have is diffed against the KEPT required stack, so vue stays.
  assert.deepEqual(d.changes.stackNiceToHave, ['vue', 'mysql', 'docker']);
  assert.equal(d.warnings.length, 1);
});

test('a scan matching the profile changes nothing', () => {
  const d = buildProfileDraft(PROFILE, {
    title: null,
    seniority: 'senior',
    skills: ['PHP', 'Laravel', 'MySQL'], // case differs — still equal
    primarySkills: ['Laravel', 'php'],
    roleTypes: ['backend'],
  });
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.changes, {});
});

test('unknown seniority and empty scan lists are ignored', () => {
  const d = buildProfileDraft(PROFILE, {
    title: null,
    seniority: 'architect',
    skills: [],
    primarySkills: [],
    roleTypes: [],
  });
  assert.deepEqual(d.changed, []);
  assert.equal(d.warnings.length, 1);
});
