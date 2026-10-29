import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '@prisma/client';
import { z } from 'zod';
import { firstIssue } from './flash';
import {
  blankSearchToReuse,
  lineListField,
  minFitField,
  minSalaryField,
  profileFieldLabel,
  reclassifyQuestion,
  sentProfile,
  seniorityField,
  tagListField,
} from './profile-form';

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
  assert.equal(profileFieldLabel('stackRequired'), 'Core skills');
  assert.equal(profileFieldLabel('priorityRules'), undefined);
});

/** The first refusal of one field, as the save's flash words it. */
const refusal = (field: z.ZodType, sent: unknown): string => {
  const parsed = z.object({ f: field }).safeParse({ f: sent });
  assert.equal(parsed.success, false, JSON.stringify(sent));
  return parsed.success ? '' : firstIssue(parsed.error.issues);
};

test('a minimum salary past what the editor takes is refused, never a 500 from the column (#646)', () => {
  const form = z.object({ minSalaryUsd: minSalaryField });
  assert.deepEqual(form.parse({ minSalaryUsd: '150000' }), { minSalaryUsd: 150_000 });
  assert.deepEqual(form.parse({ minSalaryUsd: '' }), { minSalaryUsd: 0 }, 'emptied is no salary filter, as the hint says');
  assert.deepEqual(form.parse({}), { minSalaryUsd: 0 });
  assert.equal(refusal(minSalaryField, '3000000000'), 'f: Must be 10,000,000 or less');
  assert.equal(refusal(minSalaryField, '-1'), 'f: Must be 0 or more');
});

test('seniority takes the levels the editor offers and no other (#646)', () => {
  const form = z.object({ seniority: seniorityField });
  assert.deepEqual(form.parse({ seniority: ['senior', 'lead', 'senior'] }), { seniority: ['senior', 'lead'] });
  assert.deepEqual(form.parse({ seniority: 'mid' }), { seniority: ['mid'] });
  assert.deepEqual(form.parse({}), { seniority: [] });
  assert.match(refusal(seniorityField, ['senior', '<script>alert(1)</script>']), /^f\.1: /);
  refusal(seniorityField, 'wizard');
});

test('a tag list keeps one entry per term and is refused past its limits, not cut (#646)', () => {
  const form = z.object({ stackRequired: tagListField, onsiteCities: lineListField });
  assert.deepEqual(form.parse({ stackRequired: 'TypeScript, typescript\nNode.js,TYPESCRIPT', onsiteCities: 'Austin, TX\naustin, tx' }), {
    stackRequired: ['TypeScript', 'Node.js'],
    onsiteCities: ['Austin, TX'],
  });
  assert.deepEqual(form.parse({}), { stackRequired: [], onsiteCities: [] });
  const many = Array.from({ length: 51 }, (_, i) => `skill${i}`).join(', ');
  assert.equal(refusal(tagListField, many), 'f: At most 50 items');
  assert.equal(z.object({ f: tagListField }).safeParse({ f: Array.from({ length: 51 }, () => 'go').join(',') }).success, true, 'repeats do not count');
  assert.equal(refusal(tagListField, `go, ${'x'.repeat(81)}`), 'f.1: At most 80 characters');
});

test('"+ New search" opens the paused blank search there is, instead of another (#646)', () => {
  const search = (id: number, active: boolean, stackRequired: string[] = []) => ({ id, active, stackRequired, roleTypes: [] });
  assert.equal(blankSearchToReuse([search(1, true, ['node.js']), search(4, false)]), 4);
  assert.equal(blankSearchToReuse([search(1, true, ['node.js']), search(2, false, ['go'])]), null, 'a paused search with content is not blank');
  assert.equal(blankSearchToReuse([search(1, true)]), null, 'a running one is not reused');
});

test('an emptied "Minimum fit score" is refused, never read as 0 (#682)', () => {
  const form = z.object({ minFitScore: minFitField });
  assert.deepEqual(form.parse({}), { minFitScore: 70 }, 'a form without the field gets the default');
  assert.deepEqual(form.parse({ minFitScore: '85' }), { minFitScore: 85 });
  for (const sent of ['', '  ', '101', '-1', 'abc', '7.5']) {
    const parsed = form.safeParse({ minFitScore: sent });
    assert.equal(parsed.success, false, JSON.stringify(sent));
  }
  const empty = form.safeParse({ minFitScore: '' });
  assert.equal(empty.success ? '' : empty.error.issues[0]!.message, 'Required');
});
