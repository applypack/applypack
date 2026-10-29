import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '@prisma/client';
import {
  FIT_SCORING,
  anchorFitFacts,
  fitBreakdown,
  readFitFacts,
  salaryStanding,
  seniorityFit,
  verdictFromFacts,
  type StoredFitFacts,
} from './fit-score';
import { NO_PROFILE_STACK_FLAG } from './profile-guards';

const SEARCH = {
  stackRequired: ['typescript', 'node.js', 'react'],
  stackNiceToHave: ['next.js', 'postgresql', 'prisma', 'github actions', 'jest', 'aws', 'docker'],
  stackExclude: ['junior', 'intern'],
  roleTypes: ['full-stack', 'backend'],
  seniority: ['senior'],
  minSalaryUsd: 0,
} as Pick<Profile, 'stackRequired' | 'stackNiceToHave' | 'stackExclude' | 'roleTypes' | 'seniority' | 'minSalaryUsd'>;
/** A title that names no job category, so the reply's own role types decide. */
const TITLE = 'Senior Software Engineer';

const NO_SALARY = { salary_min: null, salary_max: null };
const PLN_MONTH = (min: number, max: number) => ({ salary_min: min, salary_max: max, salary_currency: 'PLN', salary_period: 'month' });

/** A reply perfect on every fact for SEARCH, as `JobScore.fitFacts` keeps it. */
const stored = (over: Partial<StoredFitFacts> = {}): StoredFitFacts => ({
  v: 1,
  stack_used: ['TypeScript', 'Node.js', 'React'],
  stack_role: 'core',
  role_types: ['Fullstack'],
  role_type: 'match',
  nice_used: ['Next.js', 'PostgreSQL', 'Prisma', 'Jest', 'AWS'],
  excluded: [],
  off_stack: 'none',
  levels: ['senior'],
  min_years: null,
  ...over,
});

const fit = (over: Partial<StoredFitFacts> = {}, salary: Parameters<typeof fitBreakdown>[3] = NO_SALARY, search = SEARCH, title = TITLE) =>
  fitBreakdown(stored(over), title, search, salary).fit;

test('a posting perfect on every fact scores 100, and the weights are what add up to it', () => {
  const s = FIT_SCORING;
  const top = s.stack.core + s.breadth + s.roleType.match + s.seniority.match + s.salary.disclosed + s.nice + s.offStack.none;
  assert.equal(top, 100);
  assert.equal(fit({}, PLN_MONTH(20_000, 27_000)), 100);
});

test('the same facts give the same number, and every fact moves it (#634)', () => {
  // The shape of the 92 cluster: core stack, right type and level, no salary.
  assert.equal(fit(), fit({ ...stored() }));
  const oneFactWorse: [string, number][] = [
    ['two nice-to-haves', fit({ nice_used: ['Next.js', 'PostgreSQL'] })],
    ['no React', fit({ stack_used: ['TypeScript', 'Node.js'] })],
    ['a mid-level posting', fit({ levels: ['mid'] })],
    ['level unstated', fit({ levels: [] })],
    ['an extra technology', fit({ off_stack: 'some' })],
    ['an adjacent role type', fit({ role_types: [], role_type: 'adjacent' })],
  ];
  for (const [what, score] of oneFactWorse) assert.ok(score < fit(), `${what}: ${score}`);
  assert.ok(fit({}, PLN_MONTH(16_800, 22_000)) > fit(), 'a disclosed salary');
});

test('the old bands hold: a core match is a match, the stack on the side is partial', () => {
  // Core stack, the right type, level unstated, no salary, two nice-to-haves, one extra technology.
  const solid = fit({ levels: [], nice_used: ['PostgreSQL', 'Docker'], off_stack: 'some' });
  assert.ok(solid >= 70 && solid < 90, `solid match ${solid}`);
  // A backend Node.js role for a full-stack search that also takes backend: still a match.
  const backend = fit({ stack_used: ['TypeScript', 'Node.js'], role_types: ['backend'], nice_used: ['Jest'] });
  assert.ok(backend >= 80, `backend ${backend}`);
  // The role is built on something else and touches TypeScript.
  const side = fit({ stack_used: ['TypeScript'], stack_role: 'secondary', nice_used: [], off_stack: 'most' }, PLN_MONTH(20_000, 25_000));
  assert.ok(side > FIT_SCORING.ceilings.stackNone && side < 70, `secondary stack ${side}`);
});

test('the ceilings are code, and a posting under one keeps its order instead of tying on it', () => {
  const { ceilings } = FIT_SCORING;
  const rich = PLN_MONTH(30_000, 40_000);
  const under = (over: Partial<StoredFitFacts>, ceiling: number) => {
    const best = fit(over, rich);
    const worse = fit({ ...over, off_stack: 'most', nice_used: [] }, NO_SALARY);
    assert.ok(best <= ceiling, `${JSON.stringify(over)}: ${best} over ${ceiling}`);
    assert.ok(worse < best, `${JSON.stringify(over)}: ${worse} ties ${best}`);
  };
  // Gotcha 8: none of the stack — ≤ 35 whatever the role type.
  under({ stack_used: [], stack_role: 'none' }, ceilings.stackNone);
  under({ role_types: [], role_type: 'adjacent' }, ceilings.roleAdjacent);
  under({ role_types: [], role_type: 'other' }, ceilings.roleOther);
  under({ levels: ['junior'] }, ceilings.seniorityMismatch);
  under({ excluded: ['junior'] }, ceilings.excluded);
  // The lowest ceiling decides; two never compound.
  assert.equal(
    fit({ role_types: [], role_type: 'other', levels: ['junior'] }, rich),
    Math.round(((100 - FIT_SCORING.roleType.match - FIT_SCORING.seniority.match) * ceilings.roleOther) / 100),
  );
  const b = fitBreakdown(stored({ role_types: [], role_type: 'other', levels: ['junior'] }), TITLE, SEARCH, rich);
  assert.deepEqual(b.ceiling, { kind: 'roleOther', value: ceilings.roleOther });
  // A level one step away costs points and sets no ceiling.
  assert.ok(fit({ levels: ['mid'] }, rich) >= 80);
});

test('a stack used on the side costs points but sets no ceiling: a misread no longer doubles (413)', () => {
  // "Senior Backend Developer (Node.js / Nest.js)", Node.js read as secondary: 72 → 46 under the old ceiling.
  const misread = fit({ stack_role: 'secondary', role_types: ['backend'] });
  assert.ok(misread > 60 && misread < 70, `${misread}`);
  assert.equal(fitBreakdown(stored({ stack_role: 'secondary' }), TITLE, SEARCH, NO_SALARY).ceiling, null);
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
  assert.ok(fit({}, PLN_MONTH(20_000, 27_000), floor) > fit({}, NO_SALARY, floor));
  assert.ok(fit({}, NO_SALARY, floor) > fit({}, PLN_MONTH(12_000, 15_000), floor));
});

test('a search with no required stack earns no stack points and stays within the blank-search cap', () => {
  const blank = { ...SEARCH, stackRequired: [] };
  const best = fit({ stack_used: [], stack_role: 'none' }, PLN_MONTH(20_000, 27_000), blank);
  assert.equal(best, 50);
  const worse = fit({ stack_used: [], stack_role: 'none', levels: [] }, NO_SALARY, blank);
  assert.ok(worse < best, 'below the cap the order survives');
});

test('the facts are held to the search: its items, its spelling, its lists', () => {
  const held = anchorFitFacts(
    stored({
      stack_used: ['Node.JS', 'TypeScript', 'Kotlin', 'nextjs'],
      nice_used: ['React', 'GitHub-Actions', 'Postgres', 'typescript'],
      excluded: ['Junior', 'contract'],
    }),
    TITLE,
    SEARCH,
  );
  // The search's order and spelling; an item it never listed is gone; one in the wrong list moves.
  assert.deepEqual(held.stackUsed, ['typescript', 'node.js', 'react']);
  assert.deepEqual(held.niceUsed, ['next.js', 'github actions']);
  assert.deepEqual(held.excluded, ['junior']);
});

test('a role that uses none of the listed stack has no core, whatever the reply called it', () => {
  const held = anchorFitFacts(stored({ stack_used: ['Ruby', 'Rails'], nice_used: [], stack_role: 'core' }), TITLE, SEARCH);
  assert.deepEqual(held.stackUsed, []);
  assert.equal(held.stackRole, 'none');
  // An auto-reject signal the search never listed cannot cap anything.
  assert.deepEqual(anchorFitFacts(stored({ excluded: ['senior'] }), TITLE, SEARCH).excluded, []);
  // Named items with "none" are a contradiction the definition settles: the stack is used, on the side.
  assert.equal(anchorFitFacts(stored({ stack_used: ['TypeScript'], stack_role: 'none' }), TITLE, SEARCH).stackRole, 'secondary');
});

test('the role type is a match exactly when the job is one of the search\'s own role types', () => {
  // The search is called "Full-Stack" and lists backend too: a backend role matches it.
  const backend = anchorFitFacts(stored({ role_types: ['Back-end'], role_type: 'adjacent' }), TITLE, SEARCH);
  assert.deepEqual(backend.roles, ['backend']);
  assert.equal(backend.roleType, 'match');
  // None of its types: a "match" without one reads as the neighbour it is; "other" stays other.
  assert.equal(anchorFitFacts(stored({ role_types: ['frontend'], role_type: 'match' }), TITLE, SEARCH).roleType, 'adjacent');
  assert.equal(anchorFitFacts(stored({ role_types: [], role_type: 'other' }), TITLE, SEARCH).roleType, 'other');
  // A search that accepts any role type takes every job.
  assert.equal(anchorFitFacts(stored({ role_types: [], role_type: 'other' }), TITLE, { ...SEARCH, roleTypes: [] }).roleType, 'match');
});

test('a job category the title names decides the role type, whatever the reply filed it under (515)', () => {
  const frontend = 'Senior Frontend Developer (React + React Native)';
  // Filed as full-stack, it scored 91 where its two identical copies scored 28 and 29.
  const filed = anchorFitFacts(stored({ role_types: ['full-stack'], role_type: 'match' }), frontend, SEARCH);
  assert.deepEqual(filed.roles, []);
  assert.equal(filed.roleType, 'adjacent');
  assert.ok(fit({ role_types: ['full-stack'] }, PLN_MONTH(20_000, 25_000), SEARCH, frontend) < 70);
  // A title that names one of the search's categories is a match even where the reply said otherwise.
  assert.equal(anchorFitFacts(stored({ role_types: [], role_type: 'adjacent' }), 'Node.JS Back-end Engineer', SEARCH).roleType, 'match');
  // Half platform work, still full-stack by its title; a title with no category word leaves it to the reply.
  assert.equal(anchorFitFacts(stored(), 'Fullstack TypeScript Developer (Platform / DevOps)', SEARCH).roleType, 'match');
  assert.equal(anchorFitFacts(stored({ role_types: ['full-stack'] }), 'Software Developer (React + Python + AI)', SEARCH).roleType, 'match');
  // A search whose role types name no category of the list is never overruled by a title.
  const custom = { ...SEARCH, roleTypes: ['developer advocate'] };
  assert.equal(anchorFitFacts(stored({ role_types: ['developer advocate'] }), frontend, custom).roleType, 'match');
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

test('stored facts are read back by their schema, and anything else reads as none', () => {
  assert.deepEqual(readFitFacts(JSON.parse(JSON.stringify(stored()))), stored());
  assert.equal(readFitFacts(null), null, 'a row scored before v7');
  assert.equal(readFitFacts({ ...stored(), v: 2 }), null, 'a shape this code does not know');
  assert.equal(readFitFacts({ ...stored(), stack_role: 'primary' }), null);
});

test('an edited search re-scores the same stored facts with no call: a level added, a skill moved', () => {
  const facts = stored({ levels: ['mid'], nice_used: ['Next.js'] });
  const before = fitBreakdown(facts, TITLE, SEARCH, NO_SALARY).fit;
  assert.ok(fitBreakdown(facts, TITLE, { ...SEARCH, seniority: ['mid', 'senior'] }, NO_SALARY).fit > before, 'mid is now asked for');
  // Next.js moved from preferred to core: the stack is wider and the nice-to-haves are fewer.
  const moved = { ...SEARCH, stackRequired: [...SEARCH.stackRequired, 'next.js'], stackNiceToHave: SEARCH.stackNiceToHave.filter((s) => s !== 'next.js') };
  assert.deepEqual(anchorFitFacts(facts, TITLE, moved).stackUsed, ['typescript', 'node.js', 'react', 'next.js']);
});

test('a verdict from facts carries the tags, the facts and the blank-search cap, and drops a stale cap flag', () => {
  const base = { location_match: true, ...NO_SALARY, red_flags: ['no-salary-listed', NO_PROFILE_STACK_FLAG], summary: 's' };
  const v = verdictFromFacts(base, stored(), TITLE, SEARCH);
  assert.deepEqual(v.tech_match, ['typescript', 'node.js', 'react', 'next.js', 'postgresql', 'prisma', 'jest', 'aws']);
  assert.deepEqual(v.fit_facts, stored());
  assert.deepEqual(v.red_flags, ['no-salary-listed'], 'the search has a stack now: the old flag goes');
  const blank = verdictFromFacts(base, stored(), TITLE, { ...SEARCH, stackRequired: [] });
  assert.ok(blank.fit_score <= 50 && blank.red_flags.includes(NO_PROFILE_STACK_FLAG));
});
