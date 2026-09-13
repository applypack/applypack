import { effectiveRequirement } from '../resume/keyword-overrides';
import type { MatchAction, MatchHardRequirement, MatchKeyword } from '../resume/prompts';
import { clipWords } from '../text-utils';
import type { MatchAlignment, ScoreBreakdown } from '../resume/score';

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

/*
 * The one thing to do next, in a sentence.
 *
 * The five lines above say what the number was made of. A candidate reading
 * "Shown at work — 4 of 7 in a bullet · 3 named only in a list" still has to
 * work out WHICH of the three to move, and whether that outranks a title
 * grading "partial" and a gate the resume is silent on. That ranking is a
 * judgment, it is the same judgment every time, and it is made here from the
 * row already stored rather than left to the reader.
 *
 * The ladder runs from what no wording can fix down to what editing reaches:
 * a failed gate, the core stack, an unanswered gate, a must-have term, a
 * must-have shown only in a list, a weak first glance, and finally the
 * report's own first high-priority edit. It names ONE thing, always something
 * the reader can act on, and it says nothing when the report is clean —
 * "Ready to apply" already covers that, and two sentences saying it is one
 * too many.
 *
 * Nothing here re-judges anything: every rung reads a verdict the comparison
 * already wrote. Pure, no AI call, no new column.
 */

export interface AdviceInput extends LinesInput {
  /** The report's suggested edits, in the order it wrote them. */
  actions: MatchAction[];
}

/** Longest an action's own sentence may run before it stops being a glance. */
const MAX_ADVICE_CHARS = 110;

/** A gate is written by the posting and can run to a paragraph; the sentence quoting it cannot. */
const MAX_GATE_CHARS = 70;

/** How many missing core-stack terms are worth naming before the sentence stops being one. */
const MAX_NAMED_TERMS = 2;

/** How a grade below `strong` reads as words. `strong` never reaches here — it is not a gap. */
const ALIGNMENT_GAP: Record<MatchAlignment['title'], string> = {
  strong: 'matches',
  partial: 'only partly matches',
  off: 'does not match',
};

/**
 * The model's own sentence, capitalised only where that cannot damage a name:
 * "iOS navigation" and "eBay checkout" open lowercase on purpose and a second
 * capital is the tell. Two lowercase letters means prose, which in practice is
 * every action — they open with a verb. A tool spelled lowercase throughout
 * ("npm audit") is the one case this still gets wrong, and it costs a capital,
 * not a meaning.
 */
function openingCase(text: string): string {
  return /^\p{Ll}\p{Ll}/u.test(text) ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

export function mainAdvice({ breakdown, keywords, hard, actions }: AdviceInput): string | null {
  const failed = hard.find((h) => h.status === 'fail');
  if (failed) {
    return `“${clipWords(failed.requirement, MAX_GATE_CHARS)}” is not met — a gate decides this before any wording does.`;
  }

  // The cap is the biggest lever in the formula and the only one no edit
  // moves: without a word of the core stack, every other improvement is
  // arithmetic under a ceiling.
  if (breakdown.cap !== null && breakdown.primaryPresent === 0) {
    const missing = keywords
      .filter((k) => k.primary && k.status !== 'present' && k.status !== 'add')
      .map((k) => k.term);
    const named = missing.slice(0, MAX_NAMED_TERMS).join(' and ');
    if (named === '') {
      return `Nothing you write lifts this past ${breakdown.cap} — the core stack this role is written in is missing.`;
    }
    // Naming two of five and calling those two "the core stack" would be a
    // false statement, so the ones that did not fit are counted, not dropped.
    const rest = missing.length - MAX_NAMED_TERMS;
    const many = missing.length > 1;
    const subject = rest > 0 ? `${named} and ${rest} more` : named;
    return `${subject} ${many ? 'are' : 'is'} the core stack here — nothing you write lifts this past ${breakdown.cap} without ${many ? 'them' : 'it'}.`;
  }

  const unanswered = hard.find((h) => h.status === 'unknown');
  if (unanswered) {
    return `The resume is silent on “${clipWords(unanswered.requirement, MAX_GATE_CHARS)}” — a gate the reader checks before the words.`;
  }

  const musts = keywords.filter((k) => effectiveRequirement(k) === 'must');

  // "add" means the resume's own facts already evidence the term and the word
  // itself is missing — the cheapest points on the page, and the only rung
  // that asks for nothing but typing.
  const unwritten = musts.find((k) => k.status === 'add');
  if (unwritten) {
    return `Write ${unwritten.term} into the text — your own experience evidences it and the word is not there.`;
  }

  const unbacked = musts.find((k) => k.status === 'ask_user' || k.status === 'cannot_claim');
  if (unbacked) return `${unbacked.term} is a must here and nothing backs it yet — confirm it where it is true.`;

  // Named on a skills line and never shown at work: the score counts it in
  // full, a human reads it as a claim with nothing behind it (evidence.ts).
  const listed = musts.filter((k) => k.status === 'present' && k.evidence === 'listed');
  const first = listed[0];
  if (first) {
    const tail =
      listed.length === 1
        ? 'a term in a list proves nothing to a reader.'
        : `${listed.length} must-haves are named and never shown.`;
    return `Show ${first.term} in a bullet, not only on the skills line — ${tail}`;
  }

  const alignment = breakdown.alignment;
  if (alignment) {
    const weak = [
      { where: 'title', grade: alignment.title },
      { where: 'summary', grade: alignment.summary },
      { where: 'most recent role', grade: alignment.recent_role },
    ].find((g) => g.grade !== 'strong');
    if (weak) return `Sharpen the ${weak.where} — it ${ALIGNMENT_GAP[weak.grade]} this posting.`;
  }

  const edit = actions.find((a) => a.priority === 'high') ?? actions[0];
  if (edit) {
    const what = clipWords(edit.what, MAX_ADVICE_CHARS);
    // Every other rung is a sentence; the model's clause becomes one here
    // rather than sitting among them without a stop.
    return what === '' ? null : `${openingCase(what)}${/[.!?…]$/.test(what) ? '' : '.'}`;
  }

  return null;
}
