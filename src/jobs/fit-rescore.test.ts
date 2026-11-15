import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '@prisma/client';
import { rescoreFromFacts, type RescoreRow } from './fit-rescore';
import type { StoredFitFacts } from '../fit-score';
import type { StoredPlace } from './location-merge';

const search = (over: Partial<Profile> = {}): Profile =>
  ({
    id: 1,
    name: 'Full-stack',
    stackRequired: ['typescript', 'node.js', 'react'],
    stackNiceToHave: ['postgresql'],
    stackExclude: [],
    roleTypes: ['full-stack', 'backend'],
    seniority: ['senior'],
    minSalaryUsd: 0,
    minFitScore: 70,
    priorityRules: [],
    countries: ['PL'],
    regions: [],
    workplace: ['REMOTE'],
    residence: null,
    notificationTargetId: null,
    ...over,
  }) as Profile;

const JOB = {
  title: 'Node.js Developer',
  description: 'Node.js, TypeScript, PostgreSQL.',
  location: 'Remote · Poland',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
};
const PLACE: StoredPlace = { workplace: 'REMOTE', countries: ['PL'], regions: [], source: 'parsed' };

const facts: StoredFitFacts = {
  v: 1,
  stack_used: ['TypeScript', 'Node.js'],
  stack_role: 'core',
  role_types: ['backend'],
  role_type: 'match',
  nice_used: ['PostgreSQL'],
  excluded: [],
  off_stack: 'none',
  levels: ['mid'],
  min_years: 3,
};
const row = (over: Partial<RescoreRow> = {}): RescoreRow => ({
  profileId: 1,
  fitScore: 66,
  locationMatch: true,
  redFlags: [],
  summary: 'Backend Node.js role.',
  fitFacts: facts,
  ...over,
});

test('a search that now asks for the posting\'s level re-scores it from the stored facts, no call (ADR 0064)', () => {
  const now = rescoreFromFacts(JOB, [row()], new Map([[1, search({ seniority: ['mid', 'senior'] })]]), PLACE);
  assert.ok(now);
  // core 40 + 2 of 3 10·⅔ + backend 15 + level 15 + no salary 4 + 1 of 1 nice 5 + nothing else 5 = 91.
  assert.equal(now.merged.winner.classification.fit_score, 91);
  assert.deepEqual(now.rows, [{ profileId: 1, before: 66, after: 91, crossed: 'up' }]);
  assert.equal(now.keptBefore, false);
  assert.equal(now.keptNow, true);
  assert.equal(now.merged.scoreLine, 'Full-stack 91');
});

test('the steps after the number are the tick\'s own: a priority rule lifts it, the floor decides', () => {
  const rule = [{ label: 'Node remote', techsAny: ['node.js'], regionsAny: [], minFitFloor: 95 }];
  const now = rescoreFromFacts(JOB, [row()], new Map([[1, search({ priorityRules: rule })]]), PLACE);
  assert.equal(now?.merged.winner.classification.fit_score, 95);
  assert.deepEqual(now?.merged.winner.priorityRulesApplied, ['Node remote']);
  // A mid-level posting for a senior search: 80 from the same facts, under a floor of 90 it cleared at 92.
  const strict = rescoreFromFacts(JOB, [row({ fitScore: 92 })], new Map([[1, search({ minFitScore: 90 })]]), PLACE);
  assert.deepEqual(strict?.rows, [{ profileId: 1, before: 92, after: 80, crossed: 'down' }]);
  assert.equal(strict?.keptBefore, true);
  assert.equal(strict?.keptNow, false);
});

test('nothing is half re-scored: a row without facts, or a search that is gone, leaves the posting alone', () => {
  const two = [row(), row({ profileId: 2, fitFacts: null })];
  const searches = new Map([[1, search()], [2, search({ id: 2, name: 'QA' })]]);
  assert.equal(rescoreFromFacts(JOB, two, searches, PLACE), null);
  assert.equal(rescoreFromFacts(JOB, [row({ profileId: 3 })], searches, PLACE), null);
  assert.equal(rescoreFromFacts(JOB, [], searches, PLACE), null);
});
