import type { Profile } from '@prisma/client';
import { toUsdPerYear } from './currency';

/*
 * ADR 0064: the classifier's fit score is arithmetic over facts, the way ADR
 * 0012 made the resume score. The model reports what the posting shows for
 * each search — which required technologies the role uses and whether one is
 * its main stack, which of its role types the job is, the nice-to-haves, the
 * auto-reject signals, the technology outside both lists — and, once for the
 * posting, the levels it names and the years it asks for; this module turns
 * that into the number. Asked for the number itself, the model picked one
 * per band of its guidance: 38 of 52 matches scored exactly 92 (#634).
 *
 * Location is not a component: `location_match` is a gate of its own
 * (verdict-merge.ts:decideDismissReason), and a posting closed to the search
 * is dismissed for that, not scored down into "low fit".
 */

export const STACK_ROLES = ['core', 'secondary', 'none'] as const;
export const ROLE_FITS = ['match', 'adjacent', 'other'] as const;
export const OFF_STACK = ['none', 'some', 'most'] as const;

/**
 * The seniority ladder, one step a rung (staff and lead share one). The model
 * only says which rungs the posting names; how far that is from the search's
 * is counted here, because asked to judge it the model called the same
 * "Level: Regular" posting a match in one run and two steps off in the next.
 */
const LEVEL_STEP: Readonly<Record<string, number>> = {
  intern: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  staff: 4,
  lead: 4,
  principal: 5,
};
export const LEVELS = Object.keys(LEVEL_STEP) as readonly string[];
/** The words a search's own seniority list may use for a rung (the editor writes the ladder's). */
const LEVEL_ALIASES: Readonly<Record<string, string>> = { regular: 'mid', middle: 'mid', intermediate: 'mid', medior: 'mid' };
/** What a search that lists no level hunts for — the prompt has always said "mid-to-senior". */
const DEFAULT_LEVELS = ['mid', 'senior'];
/** Years asked → a rung, used only when the posting names no level. */
const YEARS_TO_STEP: readonly [number, number][] = [
  [8, LEVEL_STEP.staff!],
  [5, LEVEL_STEP.senior!],
  [2, LEVEL_STEP.mid!],
  [0, LEVEL_STEP.junior!],
];

type StackRole = (typeof STACK_ROLES)[number];
type RoleFit = (typeof ROLE_FITS)[number];
type SeniorityFit = 'match' | 'adjacent' | 'mismatch' | 'unstated';
type OffStack = (typeof OFF_STACK)[number];

/** One search's facts as the reply states them, before they are held to the search's own lists. */
export interface ReportedFacts {
  stack_used: string[];
  stack_role: StackRole;
  role_types: string[];
  role_type: RoleFit;
  nice_used: string[];
  excluded: string[];
  off_stack: OffStack;
}

/** The posting's own level, read once for every search, as salary is. */
export interface PostingLevel {
  levels: string[];
  min_years: number | null;
}

/** The facts the score reads: every named item is one of the search's own, in its own spelling. */
export interface FitFacts {
  stackUsed: string[];
  stackRole: StackRole;
  /** The search's acceptable role types the job is; any one makes the role type a match. */
  roles: string[];
  roleType: RoleFit;
  seniority: SeniorityFit;
  niceUsed: string[];
  excluded: string[];
  offStack: OffStack;
}

type FitProfile = Pick<Profile, 'stackRequired' | 'stackNiceToHave' | 'stackExclude' | 'minSalaryUsd'>;
type AnchorProfile = Pick<Profile, 'stackRequired' | 'stackNiceToHave' | 'stackExclude' | 'roleTypes' | 'seniority'>;
/** The posting's own pay, as the reply hoists it for every search. */
interface Salary {
  salary_min: number | null;
  salary_max: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;
}

/**
 * The weights add up to 100 for a posting that is perfect on every fact. A
 * fact the old guidance called a partial match or a clear miss also sets a
 * ceiling, and the points are scaled under it rather than clipped to it, so
 * two postings under the same ceiling keep their order instead of tying on
 * it (#634). Where several apply, the lowest decides; they never compound.
 */
export const FIT_SCORING = {
  stack: { core: 40, secondary: 15, none: 0 },
  /** × the share of the search's required list the role uses. */
  breadth: 10,
  roleType: { match: 15, adjacent: 7, other: 0 },
  seniority: { match: 15, unstated: 10, adjacent: 4, mismatch: 0 },
  salary: { disclosed: 10, undisclosed: 4, under: 0 },
  /** × the share of the first `niceSaturation` nice-to-haves the role uses. */
  nice: 5,
  niceSaturation: 5,
  offStack: { none: 5, some: 2, most: 0 },
  ceilings: {
    /** The rule gotcha 8 put in the prompt: none of the required stack, whatever the role type. */
    stackNone: 35,
    /** The stack is used on the side: the guidance's "off-stack", a partial match. */
    stackSecondary: 69,
    /** A neighbouring category the search does not accept: partial. */
    roleAdjacent: 69,
    /** A different discipline that happens to use the stack: a miss. */
    roleOther: 39,
    /** Junior when the search wants senior: a miss. */
    seniorityMismatch: 39,
    /** An auto-reject signal describes the role. */
    excluded: 25,
  },
} as const;

/**
 * One spelling per technology: "Node.JS", "nodejs", "node.js" and "Node" are
 * one, as are "Vue.js" and "vue"; "c++" and "c#" keep their marks.
 */
function termKey(term: string): string {
  const key = term.toLowerCase().replace(/[^a-z0-9+#]/g, '');
  return key.length > 4 && key.endsWith('js') ? key.slice(0, -2) : key;
}

function listed(list: string[]): string[] {
  return list.map((item) => item.trim()).filter((item) => item.length > 0);
}

/** The search's items the reply named, in the search's order and spelling, each once. */
function namedFrom(list: string[], named: Set<string>, taken: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const item of listed(list)) {
    const key = termKey(item);
    if (key.length === 0 || !named.has(key) || taken.has(key)) continue;
    taken.add(key);
    out.push(item);
  }
  return out;
}

function stepOf(level: string): number | undefined {
  const word = level.trim().toLowerCase();
  return LEVEL_STEP[LEVEL_ALIASES[word] ?? word];
}

/**
 * How far the posting's level is from the search's: the closest pair of
 * rungs decides (a "Senior" title over a "Level: Regular" line is senior to
 * a senior search), the years asked stand in when no level is named, and a
 * posting that says neither is unstated.
 */
export function seniorityFit(posting: PostingLevel, searchLevels: string[]): SeniorityFit {
  const wanted = searchLevels.map(stepOf).filter((n): n is number => n !== undefined);
  const search = wanted.length > 0 ? wanted : DEFAULT_LEVELS.map((l) => LEVEL_STEP[l]!);
  const named = posting.levels.map(stepOf).filter((n): n is number => n !== undefined);
  const years = posting.min_years;
  const steps =
    named.length > 0
      ? named
      : typeof years === 'number' && years >= 0
        ? [YEARS_TO_STEP.find(([floor]) => years >= floor)![1]]
        : [];
  if (steps.length === 0) return 'unstated';
  const distance = Math.min(...steps.flatMap((p) => search.map((w) => Math.abs(p - w))));
  return distance === 0 ? 'match' : distance === 1 ? 'adjacent' : 'mismatch';
}

/**
 * Holds a reply's facts to the search they are about. An item the search
 * never listed is dropped, as an unanchored quote is (ADR 0045); an item put
 * in the wrong list moves to the one the search keeps it in; a role that
 * uses none of the required stack has no stack to call its core, and one
 * that uses some has more than none. The role type is a match exactly when
 * the job is one of the search's own role types: asked to grade it, the
 * model called backend roles "adjacent" for a search that lists backend,
 * because the search was called "Full-Stack".
 */
export function anchorFitFacts(reported: ReportedFacts, posting: PostingLevel, profile: AnchorProfile): FitFacts {
  const named = new Set([...reported.stack_used, ...reported.nice_used].map(termKey));
  const taken = new Set<string>();
  const stackUsed = namedFrom(profile.stackRequired, named, taken);
  const niceUsed = namedFrom(profile.stackNiceToHave, named, taken);
  const excluded = namedFrom(profile.stackExclude, new Set(reported.excluded.map(termKey)));
  const stackRole: StackRole =
    stackUsed.length === 0 ? 'none' : reported.stack_role === 'none' ? 'secondary' : reported.stack_role;
  const roles = namedFrom(profile.roleTypes, new Set(reported.role_types.map(termKey)));
  const roleType: RoleFit =
    roles.length > 0 || listed(profile.roleTypes).length === 0
      ? 'match'
      : reported.role_type === 'match'
        ? 'adjacent'
        : reported.role_type;
  return {
    stackUsed,
    stackRole,
    roles,
    roleType,
    seniority: seniorityFit(posting, profile.seniority),
    niceUsed,
    excluded,
    offStack: reported.off_stack,
  };
}

/** What the posting says about pay against the search's floor; the same conversion the low-salary dismissal reads. */
export function salaryStanding(salary: Salary, minSalaryUsd: number): keyof typeof FIT_SCORING.salary {
  const usd =
    toUsdPerYear(salary.salary_min, salary.salary_currency, salary.salary_period) ??
    toUsdPerYear(salary.salary_max, salary.salary_currency, salary.salary_period);
  if (usd === null) return 'undisclosed';
  return minSalaryUsd > 0 && usd < minSalaryUsd ? 'under' : 'disclosed';
}

/**
 * The fit score of one search's facts. Pure: the same facts give the same
 * number, and every fact moves it, so two postings tie only when their facts
 * add up the same — never because a band has one favourite number. A search
 * with no required stack earns no stack points and at most the 50 the
 * blank-search cap allows anyway (profile-guards.ts).
 */
export function fitFromFacts(facts: FitFacts, profile: FitProfile, salary: Salary): number {
  const s = FIT_SCORING;
  const required = listed(profile.stackRequired).length;
  const stack =
    facts.stackRole === 'none' || required === 0
      ? 0
      : s.stack[facts.stackRole] + s.breadth * Math.min(1, facts.stackUsed.length / required);
  const niceOf = Math.min(s.niceSaturation, listed(profile.stackNiceToHave).length);
  const nice = niceOf === 0 ? s.nice : (s.nice * Math.min(facts.niceUsed.length, niceOf)) / niceOf;
  const points =
    stack +
    s.roleType[facts.roleType] +
    s.seniority[facts.seniority] +
    s.salary[salaryStanding(salary, profile.minSalaryUsd)] +
    nice +
    s.offStack[facts.offStack];

  const c = s.ceilings;
  const ceiling = Math.min(
    100,
    required > 0 && facts.stackRole === 'none' ? c.stackNone : 100,
    facts.stackRole === 'secondary' ? c.stackSecondary : 100,
    facts.roleType === 'adjacent' ? c.roleAdjacent : 100,
    facts.roleType === 'other' ? c.roleOther : 100,
    facts.seniority === 'mismatch' ? c.seniorityMismatch : 100,
    facts.excluded.length > 0 ? c.excluded : 100,
  );
  return Math.max(0, Math.min(100, Math.round((points * ceiling) / 100)));
}

/** The tags the stack facets read: the search's own required and nice-to-have items the role uses, lower case. */
export function techTags(facts: FitFacts): string[] {
  return [...new Set([...facts.stackUsed, ...facts.niceUsed].map((t) => t.toLowerCase()))];
}
