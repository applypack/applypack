import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '@prisma/client';
import { FIT_SCORING, anchorFitFacts, fitFromFacts, salaryStanding, seniorityFit, techTags, type FitFacts, type ReportedFacts } from './fit-score';

const SEARCH = {
  stackRequired: ['typescript', 'node.js', 'react'],
  stackNiceToHave: ['next.js', 'postgresql', 'prisma', 'github actions', 'jest', 'aws', 'docker'],
  stackExclude: ['junior', 'intern'],
  roleTypes: ['full-stack', 'backend'],
  seniority: ['senior'],
  minSalaryUsd: 0,
} as Pick<Profile, 'stackRequired' | 'stackNiceToHave' | 'stackExclude' | 'roleTypes' | 'seniority' | 'minSalaryUsd'>;
const SENIOR = { levels: ['senior'], min_years: null };

const NO_SALARY = { salary_min: null, salary_max: null };
const PLN_MONTH = (min: number, max: number) => ({ salary_min: min, salary_max: max, salary_currency: 'PLN', salary_period: 'month' });

const facts = (over: Partial<FitFacts> = {}): FitFacts => ({
  stackUsed: ['typescript', 'node.js', 'react'],
  stackRole: 'core',
  roles: ['full-stack'],
  roleType: 'match',
  seniority: 'match',
  niceUsed: ['next.js', 'postgresql', 'prisma', 'jest', 'aws'],
  excluded: [],
  offStack: 'none',
  ...over,
});

const reported = (over: Partial<ReportedFacts> = {}): ReportedFacts => ({
  stack_used: ['TypeScript', 'Node.js', 'React'],
  stack_role: 'core',
  role_types: ['Fullstack'],
  role_type: 'match',
  nice_used: [],
  excluded: [],
  off_stack: 'none',
  ...over,
});

const fit = (f: FitFacts, salary: Parameters<typeof fitFromFacts>[2] = NO_SALARY, search = SEARCH) => fitFromFacts(f, search, salary);

test('a posting perfect on every fact scores 100, and the weights are what add up to it', () => {
  const s = FIT_SCORING;
  const top = s.stack.core + s.breadth + s.roleType.match + s.seniority.match + s.salary.disclosed + s.nice + s.offStack.none;
  assert.equal(top, 100);
  assert.equal(fit(facts(), PLN_MONTH(20_000, 27_000)), 100);
});

test('the same facts give the same number, and every fact moves it (#634)', () => {
  // The shape of the 92 cluster: core stack, right type and level, no salary.
  const base = facts();
  assert.equal(fit(base), fit({ ...base }));
  const oneFactWorse: [string, number][] = [
    ['two nice-to-haves', fit(facts({ niceUsed: ['next.js', 'postgresql'] }))],
    ['no React', fit(facts({ stackUsed: ['typescript', 'node.js'] }))],
    ['level unstated', fit(facts({ seniority: 'unstated' }))],
    ['an extra technology', fit(facts({ offStack: 'some' }))],
    ['an adjacent role type', fit(facts({ roleType: 'adjacent' }))],
  ];
  for (const [what, score] of oneFactWorse) assert.ok(score < fit(base), `${what}: ${score}`);
  assert.ok(fit(base, PLN_MONTH(16_800, 22_000)) > fit(base), 'a disclosed salary');
});

test('the old bands hold: a core match is a match, the stack on the side is partial', () => {
  // Core stack, the right type, level unstated, no salary, two nice-to-haves, one extra technology.
  const solid = fit(facts({ seniority: 'unstated', niceUsed: ['postgresql', 'docker'], offStack: 'some' }));
  assert.ok(solid >= 70 && solid < 90, `solid match ${solid}`);
  // A backend Node.js role for a full-stack search that also takes backend: still a match.
  const backend = fit(facts({ stackUsed: ['typescript', 'node.js'], niceUsed: ['jest'] }));
  assert.ok(backend >= 80, `backend ${backend}`);
  // The role is built on something else and touches TypeScript.
  const side = fit(facts({ stackUsed: ['typescript'], stackRole: 'secondary', niceUsed: [], offStack: 'most' }), PLN_MONTH(20_000, 25_000));
  assert.ok(side > FIT_SCORING.ceilings.stackNone && side < 70, `secondary stack ${side}`);
});

test('the ceilings are code, and a posting under one keeps its order instead of tying on it', () => {
  const { ceilings } = FIT_SCORING;
  const rich = PLN_MONTH(30_000, 40_000);
  const under = (over: Partial<FitFacts>, ceiling: number) => {
    const best = fit(facts(over), rich);
    const worse = fit(facts({ ...over, offStack: 'most', niceUsed: [] }), NO_SALARY);
    assert.ok(best <= ceiling, `${JSON.stringify(over)}: ${best} over ${ceiling}`);
    assert.ok(worse < best, `${JSON.stringify(over)}: ${worse} ties ${best}`);
  };
  // Gotcha 8: none of the stack — ≤ 35 whatever the role type.
  under({ stackUsed: [], stackRole: 'none', niceUsed: [] }, ceilings.stackNone);
  under({ stackUsed: ['typescript'], stackRole: 'secondary' }, ceilings.stackSecondary);
  under({ roleType: 'adjacent' }, ceilings.roleAdjacent);
  under({ roleType: 'other' }, ceilings.roleOther);
  under({ seniority: 'mismatch' }, ceilings.seniorityMismatch);
  under({ excluded: ['junior'] }, ceilings.excluded);
  // The lowest ceiling decides; two never compound.
  assert.equal(
    fit(facts({ roleType: 'other', seniority: 'mismatch' }), rich),
    Math.round(((100 - FIT_SCORING.roleType.match - FIT_SCORING.seniority.match) * ceilings.roleOther) / 100),
  );
  // A level one step away costs points and sets no ceiling.
  assert.ok(fit(facts({ seniority: 'adjacent' }), rich) >= 80);
});

test('salary: disclosed above the floor, not disclosed, under the floor — in the posting\'s own money', () => {
  const floor = { ...SEARCH, minSalaryUsd: 60_000 };
  assert.equal(salaryStanding(NO_SALARY, 60_000), 'undisclosed');
  // 20 000 PLN a month is about $66k a year.
  assert.equal(salaryStanding(PLN_MONTH(20_000, 27_000), 60_000), 'disclosed');
  assert.equal(salaryStanding(PLN_MONTH(12_000, 15_000), 60_000), 'under');
  // Only a top of the range named: it is the number there is.
  assert.equal(salaryStanding({ salary_min: null, salary_max: 50_000 }, 60_000), 'under');
  assert.equal(salaryStanding(PLN_MONTH(12_000, 15_000), 0), 'disclosed', 'no floor: any figure is disclosed pay');
  assert.ok(fit(facts(), PLN_MONTH(20_000, 27_000), floor) > fit(facts(), NO_SALARY, floor));
  assert.ok(fit(facts(), NO_SALARY, floor) > fit(facts(), PLN_MONTH(12_000, 15_000), floor));
});

test('a search with no required stack earns no stack points and stays within the blank-search cap', () => {
  const blank = { ...SEARCH, stackRequired: [] };
  const best = fit(facts({ stackUsed: [], stackRole: 'none' }), PLN_MONTH(20_000, 27_000), blank);
  assert.equal(best, 50);
  const worse = fit(facts({ stackUsed: [], stackRole: 'none', seniority: 'unstated' }), NO_SALARY, blank);
  assert.ok(worse < best, 'below the cap the order survives');
});

test('the facts are held to the search: its items, its spelling, its lists', () => {
  const held = anchorFitFacts(
    reported({
      stack_used: ['Node.JS', 'TypeScript', 'Kotlin', 'nextjs'],
      nice_used: ['React', 'GitHub-Actions', 'Postgres', 'typescript'],
      excluded: ['Junior', 'contract'],
    }),
    SENIOR,
    SEARCH,
  );
  // The search's order and spelling; an item it never listed is gone; one in the wrong list moves.
  assert.deepEqual(held.stackUsed, ['typescript', 'node.js', 'react']);
  assert.deepEqual(held.niceUsed, ['next.js', 'github actions']);
  assert.deepEqual(held.excluded, ['junior']);
  assert.deepEqual(techTags(held), ['typescript', 'node.js', 'react', 'next.js', 'github actions']);
});

test('a role that uses none of the listed stack has no core, whatever the reply called it', () => {
  const held = anchorFitFacts(reported({ stack_used: ['Ruby', 'Rails'], stack_role: 'core' }), SENIOR, SEARCH);
  assert.deepEqual(held.stackUsed, []);
  assert.equal(held.stackRole, 'none');
  assert.ok(fit(held) <= FIT_SCORING.ceilings.stackNone);
  // An auto-reject signal the search never listed cannot cap anything.
  assert.deepEqual(anchorFitFacts(reported({ excluded: ['senior'] }), SENIOR, SEARCH).excluded, []);
  // Named items with "none" are a contradiction the definition settles: the stack is used, on the side.
  assert.equal(anchorFitFacts(reported({ stack_used: ['TypeScript'], stack_role: 'none' }), SENIOR, SEARCH).stackRole, 'secondary');
});

test('the role type is a match exactly when the job is one of the search\'s own role types', () => {
  // The search is called "Full-Stack" and lists backend too: a backend role matches it.
  const backend = anchorFitFacts(reported({ role_types: ['Back-end'], role_type: 'adjacent' }), SENIOR, SEARCH);
  assert.deepEqual(backend.roles, ['backend']);
  assert.equal(backend.roleType, 'match');
  // None of its types: a "match" without one reads as the neighbour it is; "other" stays other.
  assert.equal(anchorFitFacts(reported({ role_types: ['frontend'], role_type: 'match' }), SENIOR, SEARCH).roleType, 'adjacent');
  assert.equal(anchorFitFacts(reported({ role_types: [], role_type: 'other' }), SENIOR, SEARCH).roleType, 'other');
  // A search that accepts any role type takes every job.
  assert.equal(anchorFitFacts(reported({ role_types: [], role_type: 'other' }), SENIOR, { ...SEARCH, roleTypes: [] }).roleType, 'match');
});

test('seniority is counted in code from the levels the posting names, never judged by the model', () => {
  const senior = ['senior'];
  // The posting that read as a match in one run and two steps off in the next: a "Senior" title over "Level: Regular".
  assert.equal(seniorityFit({ levels: ['senior', 'mid'], min_years: 3 }, senior), 'match');
  assert.equal(seniorityFit({ levels: ['mid'], min_years: null }, senior), 'adjacent');
  assert.equal(seniorityFit({ levels: ['lead'], min_years: null }, senior), 'adjacent');
  assert.equal(seniorityFit({ levels: ['junior'], min_years: null }, senior), 'mismatch');
  assert.equal(seniorityFit({ levels: ['Principal'], min_years: null }, senior), 'mismatch');
  // No level named: the years stand in — "minimum 3 years" is mid, "5+" senior, "1 year" junior.
  assert.equal(seniorityFit({ levels: [], min_years: 3 }, senior), 'adjacent');
  assert.equal(seniorityFit({ levels: [], min_years: 5 }, senior), 'match');
  assert.equal(seniorityFit({ levels: [], min_years: 1 }, senior), 'mismatch');
  assert.equal(seniorityFit({ levels: [], min_years: null }, senior), 'unstated');
  assert.equal(seniorityFit({ levels: ['ninja'], min_years: null }, senior), 'unstated', 'a word off the ladder names nothing');
  // A search that lists no level hunts mid-to-senior, as the prompt always said; its own words may alias a rung.
  assert.equal(seniorityFit({ levels: ['junior'], min_years: null }, []), 'adjacent');
  assert.equal(seniorityFit({ levels: ['intern'], min_years: null }, []), 'mismatch');
  assert.equal(seniorityFit({ levels: ['mid'], min_years: null }, ['Regular']), 'match');
});
