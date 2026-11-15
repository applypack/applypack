import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '@prisma/client';
import { fitWhy } from './fit-why';
import { withLocale } from '../i18n/locale';
import type { StoredFitFacts } from '../fit-score';

const SEARCH = {
  stackRequired: ['typescript', 'node.js', 'react'],
  stackNiceToHave: ['next.js', 'postgresql', 'prisma', 'jest', 'aws'],
  stackExclude: ['junior'],
  roleTypes: ['full-stack', 'backend'],
  seniority: ['senior'],
  minSalaryUsd: 0,
} as Pick<Profile, 'stackRequired' | 'stackNiceToHave' | 'stackExclude' | 'roleTypes' | 'seniority' | 'minSalaryUsd'>;
const JOB = { title: 'Senior Backend Developer (Node.js / Nest.js)', salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };

const facts = (over: Partial<StoredFitFacts> = {}): StoredFitFacts => ({
  v: 1,
  stack_used: ['TypeScript', 'Node.js'],
  stack_role: 'core',
  role_types: ['backend'],
  role_type: 'match',
  nice_used: ['PostgreSQL', 'Jest'],
  excluded: [],
  off_stack: 'some',
  levels: ['senior'],
  min_years: null,
  ...over,
});

test('the facts behind a fit, fact by fact, folded; nothing in sight when no ceiling holds it', () => {
  // core 40 + 2 of 3 required 6.7 + type 15 + level 15 + no salary 4 + 2 of 5 nice 2 + one extra technology 2 = 85.
  const why = fitWhy({ fitScore: 85, fitFacts: facts(), priorityRulesApplied: [] }, SEARCH, JOB);
  assert.deepEqual(why.shown, []);
  assert.deepEqual(why.folded, [
    "The role is built on the search's core skills and uses 2 of the 3.",
    "It is a backend role, one of the search's target roles.",
    'Its level is one the search asks for.',
    'The posting does not state its pay.',
    "It uses 2 of the search's preferred skills.",
    'It also asks for one or two technologies the search does not list.',
  ]);
});

test('a ceiling and a number the search has moved from stay in sight', () => {
  const junior = facts({ levels: ['junior'], excluded: ['Junior'] });
  const why = fitWhy({ fitScore: 80, fitFacts: junior, priorityRulesApplied: [] }, SEARCH, JOB);
  assert.equal(why.shown[0], 'A word the search skips describes the role, so the fit is 25 at most.');
  assert.match(why.shown[1] ?? '', /^The search has changed since this was scored: the same facts give \d+ today\.$/);
  assert.ok(why.folded.includes('A word the search skips describes the role: junior.'));
  // A priority rule lifts the number on purpose: that is no drift.
  assert.equal(fitWhy({ fitScore: 80, fitFacts: junior, priorityRulesApplied: ['PHP remote'] }, SEARCH, JOB).shown.length, 1);
});

test('a row scored before the facts were kept says so, and how to bring it onto the new scale', () => {
  const why = fitWhy({ fitScore: 92, fitFacts: null, priorityRulesApplied: [] }, SEARCH, JOB);
  assert.equal(why.folded.length, 0);
  assert.match(why.shown[0] ?? '', /before the facts behind it were kept, on the old scale\. Re-classify/);
});

test('the same facts read in Ukrainian, plurals by its own rules', () => {
  const why = withLocale('uk', () => fitWhy({ fitScore: 85, fitFacts: facts(), priorityRulesApplied: [] }, SEARCH, JOB));
  assert.equal(why.folded[0], 'Роль побудована на основних навичках пошуку й використовує 2 з 3.');
  assert.equal(why.folded[4], 'Роль використовує 2 з бажаних навичок пошуку.');
});
