import type { MatchAlignment, ScoreBreakdown } from './score';
import type { MatchAction, MatchKeyword } from './prompts';

/*
 * REQUIRED COVERAGE, checked in code (ADR 0012's rule applied to the advice).
 *
 * The prompt asks for a high-priority action wherever the title, the summary or
 * the most recent role grades below `strong`, and for one wherever a must-level
 * term lives only on a skills line. Three rewordings of that rule later, a
 * matrix of ten real pairs still had comparisons that met every condition and
 * came back with an empty list: a front-end resume with React and TypeScript
 * already present, judged against a full-stack React posting, ceiling 70, no
 * actions at all — the model had decided the application was hopeless and
 * stopped, which is an editorial call it is not making with the numbers.
 *
 * So the floor is checked here instead of hoped for. What the caller does with
 * a gap is its business: match.ts spends one suggestions call to fill it, and
 * the page tells the user when a list is shorter than it should be.
 *
 * The exemptions are the ones the prompt states, and they are the point — a
 * product manager against a principal-engineer posting is owed nothing, and
 * neither is a resume whose honest ceiling nobody would apply on. Pure.
 */

/** A ceiling below this is not worth chasing: no wording reaches an application from here. */
const WORTH_CHASING = 50;

export type FloorSection = 'title' | 'summary' | 'experience' | 'skills' | 'keywords';

export interface FloorInput {
  keywords: MatchKeyword[];
  alignment: MatchAlignment | null;
  actions: MatchAction[];
  breakdown: Pick<ScoreBreakdown, 'primaryTotal' | 'primaryPresent' | 'ceiling'>;
}

/**
 * Does this candidate have part of the core of this job? The same test the
 * prompt states: one primary item covered, or — for a posting with no primary
 * stack — two must-level terms the resume can stand behind.
 */
export function hasCore(input: Pick<FloorInput, 'keywords' | 'breakdown'>): boolean {
  const covered = input.keywords.filter((k) => k.status === 'present' || k.status === 'add');
  return input.breakdown.primaryTotal > 0
    ? input.breakdown.primaryPresent > 0
    : covered.filter((k) => k.requirement === 'must').length >= 2;
}

/** The sections the rules owe an action and did not get one. Empty when the report is complete or exempt. */
export function floorGaps(input: FloorInput): FloorSection[] {
  const { alignment, actions, breakdown } = input;
  if (!alignment) return [];
  // Nothing to work with, or nothing worth working towards.
  if (!hasCore(input) || (breakdown.ceiling ?? 0) < WORTH_CHASING) return [];

  const highIn = (section: FloorSection) =>
    actions.some((a) => a.section === section && a.priority === 'high');
  const gaps: FloorSection[] = [];
  if (alignment.title !== 'strong' && !highIn('title')) gaps.push('title');
  if (alignment.summary !== 'strong' && !highIn('summary')) gaps.push('summary');
  if (alignment.recent_role !== 'strong' && !highIn('experience')) gaps.push('experience');
  // A must-level term named on a skills line and shown nowhere is the other
  // half of the floor; `evidence` is measured, so this is not a judgment call.
  const buried = input.keywords.some(
    (k) => k.requirement === 'must' && k.status === 'present' && k.evidence === 'listed',
  );
  if (buried && !actions.some((a) => a.section === 'experience' || a.section === 'skills')) gaps.push('skills');
  // A must-level term the resume's facts back but no rewrite writes in: the
  // rule asks for it, and a list of bullet rewrites with none of the posting's
  // missing words was the complaint (2026-09-30).
  if (unwrittenMusts(input).length > 0) gaps.push('keywords');
  return gaps;
}

/** Must-level terms marked "add" that no action's wording carries, by their own spelling or an alias. */
export function unwrittenMusts(input: Pick<FloorInput, 'keywords' | 'actions'>): string[] {
  const wording = input.actions.map((a) => a.replacement ?? '').join('\n');
  return input.keywords
    .filter((k) => k.requirement === 'must' && k.status === 'add')
    .filter((k) => ![k.term, ...(k.aliases ?? [])].some((t) => wordIn(wording, t)))
    .map((k) => k.term);
}

function wordIn(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/** The line the retry prompt carries — what was owed, in the words the rules use. */
export function floorDemand(gaps: FloorSection[], terms: string[] = []): string {
  const what: Record<FloorSection, string> = {
    title: 'the title line graded below strong and got no high-priority action with wording',
    summary: 'the summary graded below strong and got no high-priority action with wording',
    experience: "the most recent role graded below strong and got no high-priority action rewriting its leading bullets",
    skills: 'a must-level term the resume names only on a skills line got no action putting it inside a bullet',
    keywords: `must-level keywords marked "add" appear in no replacement (${terms.join(', ') || 'see the table'}) — write each in once: on the skills line, or into the one bullet whose work used it, in words that describe that work`,
  };
  return (
    'THE LAST REPLY MISSED REQUIRED COVERAGE. ' +
    gaps.map((g) => what[g]).join('; ') +
    '. This candidate has part of the core of this job and the ceiling is worth chasing, so the profession exemption does not apply here. Write those actions, each with a complete "replacement".'
  );
}
