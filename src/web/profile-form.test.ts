import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '@prisma/client';
import { profileFieldLabel, reclassifyQuestion, sentProfile } from './profile-form';

const STORED = {
  id: 3,
  name: 'Backend',
  active: true,
  stackRequired: ['node.js'],
  roleTypes: ['backend'],
  stackNiceToHave: [],
  stackExclude: [],
  notes: 'stored notes',
  seniority: ['senior'],
  countries: ['US'],
  regions: [],
  workplace: ['REMOTE'],
  residence: null,
  relocation: 'no',
  onsiteCities: [],
  minSalaryUsd: 90000,
  minFitScore: 70,
  notificationTargetId: null,
  resumeId: 1,
  priorityRules: [],
} as unknown as Profile;

test('a refused save comes back as it was typed, not as it was stored (#549)', () => {
  const sent = sentProfile(STORED, {
    name: 'Backend EU',
    stackRequired: 'node.js\ntypescript',
    roleTypes: 'backend, platform',
    notes: 'typed notes',
    seniority: ['senior', 'staff'],
    countries: '🇵🇱 Poland\nNeverland',
    regions: ['EU', 'NOWHERE'],
    workplace: ['REMOTE', 'HYBRID', 'moon'],
    residence: 'ua',
    relocation: 'yes',
    onsiteCities: 'Austin, TX\r\nBerlin',
    minFitScore: '80',
    minSalaryUsd: '',
    resumeId: '',
    notificationTargetId: '7',
    priorityRules: 'Elixir boost | elixir | Worldwide | high\nGo | go | Remote | 90',
  });
  const p = sent.profile;
  assert.equal(p.id, 3, 'the stored row underneath');
  assert.equal(p.name, 'Backend EU');
  assert.deepEqual(p.stackRequired, ['node.js', 'typescript']);
  assert.deepEqual(p.roleTypes, ['backend', 'platform']);
  assert.equal(p.notes, 'typed notes');
  assert.deepEqual(p.seniority, ['senior', 'staff']);
  assert.deepEqual(p.countries, ['PL'], 'the codes the gazetteer knows');
  assert.deepEqual(sent.countries, ['🇵🇱 Poland', 'Neverland'], 'and every country as typed, for the chips');
  assert.deepEqual(p.regions, ['EU']);
  assert.deepEqual(p.workplace, ['REMOTE', 'HYBRID']);
  assert.equal(p.residence, 'UA');
  assert.equal(p.relocation, 'yes');
  assert.deepEqual(p.onsiteCities, ['Austin, TX', 'Berlin'], 'a city keeps its state (#607)');
  assert.equal(p.minFitScore, 80);
  assert.equal(p.minSalaryUsd, 90000, 'a number it cannot read keeps the stored one');
  assert.equal(p.resumeId, null, 'the "pick by overlap" option');
  assert.equal(p.notificationTargetId, 7);
  assert.equal(sent.priorityRules, 'Elixir boost | elixir | Worldwide | high\nGo | go | Remote | 90', 'the refused line stays in the text');
  assert.deepEqual(
    (p.priorityRules as { label: string }[]).map((r) => r.label),
    ['Go'],
    'the lines it can read count as rules',
  );
});

test('a form that sends nothing for a field empties it, as the save would', () => {
  const sent = sentProfile(STORED, { name: 'Backend' });
  assert.deepEqual(sent.profile.countries, []);
  assert.deepEqual(sent.countries, []);
  assert.deepEqual(sent.profile.workplace, []);
  assert.equal(sent.profile.relocation, 'no');
  assert.equal(sent.priorityRules, '');
});

test('"Save & re-classify" asks with the number of jobs and the cost of the engine that answers (#562)', () => {
  assert.equal(
    reclassifyQuestion(5, 'Runs on your local model: free.'),
    'Save the search and read the 5 jobs you have not applied to again? Each one the filter lets through is scored by AI. Runs on your local model: free.',
  );
  assert.equal(reclassifyQuestion(1, ''), 'Save the search and read the 1 job you have not applied to again? If the filter lets it through, AI scores it.');
  assert.equal(reclassifyQuestion(0, 'Your plan covers it.'), 'Save the search? No job is stored yet, so there is nothing to score again.');
  assert.doesNotMatch(reclassifyQuestion(3, ''), /APPLIED/);
});

test('a refused field is named by the label the editor shows it under', () => {
  assert.equal(profileFieldLabel('minFitScore'), 'Minimum fit score (0–100)');
  assert.equal(profileFieldLabel('stackRequired'), undefined);
});
