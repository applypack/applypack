import { effectiveRequirement } from '../resume/keyword-overrides';
import type { MatchHardRequirement, MatchKeyword } from '../resume/prompts';
import type { ScoreBreakdown } from '../resume/score';

/*
 * The five sentences behind the number (docs/score-lines-plan.md).
 *
 * What this replaces said what the arithmetic did — "Keywords 60/60 ·
 * Alignment 40/40" — which is the size of a weighted pool nobody outside the
 * code knows about. A candidate is not asking how the sum was done; they are
 * asking what it decided about them. Three of these lines are the score, two
 * are not and still decide whether to send the thing: a live 100/100 sat above
 * "3 suggested edits · 5 removals", one unconfirmed hard requirement, and the
 * model's own verdict that the resume undersold itself.
 *
 * Fractions and words, never invented percentages: the variance fixture
 * measured a ±5 spread on a stable pair, so "Requirements 76%" would claim a
 * precision this system does not have. "24 of 33" is checkable.
 *
 * Pure — the stored row arrives as arguments, and everything here is already
 * in it. No AI call, no new column.
 */

export interface ScoreLine {
  label: string;
  /** The sentence itself. */
  text: string;
  /** Set when the line is asking for something rather than reporting. */
  tone?: 'ok' | 'warn' | 'danger';
  title?: string;
}

export interface ScoreLines {
  /** The three that made the number. */
  scored: ScoreLine[];
  /** The two the formula does not count, and that still decide whether to send it. */
  diagnostic: ScoreLine[];
}

export interface LinesInput {
  breakdown: ScoreBreakdown;
  keywords: MatchKeyword[];
  hard: MatchHardRequirement[];
}

const GRADES = ['title', 'summary', 'recent role'] as const;

export function scoreLines(input: LinesInput): ScoreLines {
  return {
    scored: [requirementsLine(input), coreStackLine(input), firstGlanceLine(input)].filter(
      (l): l is ScoreLine => l !== null,
    ),
    diagnostic: [shownAtWorkLine(input), toConfirmLine(input)].filter((l): l is ScoreLine => l !== null),
  };
}

/** How much of what the posting asked for the resume can stand behind. */
function requirementsLine({ breakdown, keywords }: LinesInput): ScoreLine | null {
  const counted = keywords.filter((k) => effectiveRequirement(k) !== 'context');
  if (counted.length === 0) return null;
  const met = counted.filter((k) => k.status === 'present' || k.status === 'add').length;
  return {
    label: 'Requirements',
    text: `${met} of ${counted.length} the posting asks for`,
    tone: met === counted.length ? 'ok' : undefined,
    // The weighted number is what the score actually reads; it belongs in the
    // tooltip rather than on a line a human is meant to skim.
    title: `Weighted for how hard the posting asks: ${breakdown.keywordEarned} of ${breakdown.keywordTotal}, worth ${breakdown.keywordPts} of ${breakdown.keywordMax} points.`,
  };
}

/**
 * The biggest lever in the formula, and until now visible only when it bit:
 * "capped at 30" appeared, and a candidate one keyword away from that cap had
 * no way to see it coming.
 */
function coreStackLine({ breakdown, keywords }: LinesInput): ScoreLine | null {
  if (breakdown.primaryTotal === 0) return { label: 'Core stack', text: 'this posting names none' };
  const primaries = keywords.filter((k) => k.primary);
  const have = primaries.filter((k) => k.status === 'present' || k.status === 'add');
  const missing = primaries.filter((k) => k.status !== 'present' && k.status !== 'add');
  const names = (list: MatchKeyword[]) => list.map((k) => k.term).join(' · ');
  if (breakdown.cap === null) {
    return {
      label: 'Core stack',
      text: primaries.length > 0 ? `${names(have)} — all present` : 'covered',
      tone: 'ok',
    };
  }
  return {
    label: 'Core stack',
    text:
      (missing.length > 0 ? `${names(missing)} missing` : `${breakdown.primaryPresent} of ${breakdown.primaryTotal}`) +
      ` — this alone caps the score at ${breakdown.cap}`,
    tone: 'danger',
    title: 'The languages and frameworks the role is written in. Nothing else lifts the score past this.',
  };
}

/** The three places a recruiter reads in their first six seconds. */
function firstGlanceLine({ breakdown }: LinesInput): ScoreLine | null {
  const a = breakdown.alignment;
  if (!a) return null;
  const grades = [a.title, a.summary, a.recent_role];
  const weak = GRADES.filter((_, i) => grades[i] !== 'strong');
  return {
    label: 'First glance',
    text: weak.length === 0 ? 'title, summary and recent role all strong' : `${weak.join(' and ')} could be sharper`,
    tone: weak.length === 0 ? 'ok' : 'warn',
    title: `What a recruiter reads in six seconds: title ${a.title}, summary ${a.summary}, most recent role ${a.recent_role}.`,
  };
}

/**
 * The line the formula does not count. A term named on a skills line and one
 * shown inside a bullet with a number read completely differently to a human,
 * and nothing measured the difference before `evidence` (v1.70.0).
 */
function shownAtWorkLine({ keywords }: LinesInput): ScoreLine | null {
  const wanted = keywords.filter(
    (k) => k.status === 'present' && effectiveRequirement(k) !== 'context' && k.evidence !== undefined,
  );
  if (wanted.length === 0) return null;
  const listed = wanted.filter((k) => k.evidence === 'listed');
  if (listed.length === 0) {
    return { label: 'Shown at work', text: `all ${wanted.length} appear inside your bullets`, tone: 'ok' };
  }
  return {
    label: 'Shown at work',
    text: `${wanted.length - listed.length} of ${wanted.length} in a bullet · ${listed.length} named only in a list`,
    tone: 'warn',
    title: `Named and never shown: ${listed.map((k) => k.term).join(', ')}. A skills line proves nothing to a human reader.`,
  };
}

/** Gates the score never touched: the thing that stops an application on its own. */
function toConfirmLine({ hard }: LinesInput): ScoreLine | null {
  const failed = hard.filter((h) => h.status === 'fail');
  const unknown = hard.filter((h) => h.status === 'unknown');
  if (failed.length === 0 && unknown.length === 0) {
    return hard.length === 0 ? null : { label: 'Hard requirements', text: `all ${hard.length} met`, tone: 'ok' };
  }
  const parts = [
    failed.length > 0 ? `${failed.length} not met` : null,
    unknown.length > 0 ? `${unknown.length} the resume is silent on` : null,
  ].filter(Boolean);
  return {
    label: 'To confirm',
    text: parts.join(' · '),
    tone: failed.length > 0 ? 'danger' : 'warn',
    title: [...failed, ...unknown].map((h) => h.requirement).join(' · '),
  };
}

/**
 * Whether the card may tell the user to stop and send it. The number alone
 * used to decide, so "Ready to apply — stop polishing, send it." sat above
 * three suggested edits, five removals and an unconfirmed hard requirement on
 * a live 100/100. A score is not a verdict while something is still open.
 */
export function readyToApply(input: LinesInput & { score: number; threshold: number; edits: number }): boolean {
  if (input.score < input.threshold) return false;
  if (input.edits > 0) return false;
  if (input.hard.some((h) => h.status !== 'pass')) return false;
  return !input.keywords.some((k) => k.status === 'present' && k.evidence === 'listed' && effectiveRequirement(k) === 'must');
}
