import { effectiveRequirement } from '../resume/keyword-overrides';
import type { MatchAction, MatchHardRequirement, MatchKeyword } from '../resume/prompts';
import { clipWords } from '../text-utils';
import { SCORING, type ScoreBreakdown } from '../resume/score';
import { t } from '../i18n/t';

/*
 * The five sentences behind the number (docs/score-lines-plan.md).
 *
 * What this replaces said what the arithmetic did — "Keywords 60/60 ·
 * Alignment 40/40" — which is the size of a weighted pool nobody outside the
 * code knows about. A candidate is not asking how the sum was done; they are
 * asking what it decided about them. Four of these lines are the score since
 * v6 (ADR 0058 moved "Shown at work" in; a row scored before stays as it was
 * scored), one is not and still decides whether to send the thing: a live
 * 100/100 sat above "3 suggested edits · 5 removals", one unconfirmed hard
 * requirement, and the model's own verdict that the resume undersold itself.
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
  /** The lines that made the number. */
  scored: ScoreLine[];
  /** The ones the formula does not count, and that still decide whether to send it. */
  diagnostic: ScoreLine[];
}

export interface LinesInput {
  breakdown: ScoreBreakdown;
  keywords: MatchKeyword[];
  hard: MatchHardRequirement[];
}

/** The three places a first glance reads, in the order a sentence names them. */
const GLANCE = ['title', 'summary', 'role'] as const;

/** Score v6 counts a term shown only in a list at `listedCredit` (ADR 0058); an older row did not. */
const EVIDENCE_SCORED_FROM = 6;

export function scoreLines(input: LinesInput): ScoreLines {
  const shown = shownAtWorkLine(input);
  const counted = input.breakdown.v >= EVIDENCE_SCORED_FROM;
  const present = (lines: (ScoreLine | null)[]) => lines.filter((l): l is ScoreLine => l !== null);
  return {
    scored: present([requirementsLine(input), coreStackLine(input), firstGlanceLine(input), counted ? shown : null]),
    diagnostic: present([counted ? null : shown, toConfirmLine(input)]),
  };
}

/** How much of what the posting asked for the resume can stand behind. */
function requirementsLine({ breakdown, keywords }: LinesInput): ScoreLine | null {
  const counted = keywords.filter((k) => effectiveRequirement(k) !== 'context');
  if (counted.length === 0) return null;
  const met = counted.filter((k) => k.status === 'present' || k.status === 'add').length;
  return {
    label: t('score.label.requirements'),
    text: t('score.requirements', { met, total: counted.length }),
    tone: met === counted.length ? 'ok' : undefined,
    // The weighted number is what the score actually reads; it belongs in the
    // tooltip rather than on a line a human is meant to skim.
    title: t('score.requirements.title', {
      earned: breakdown.keywordEarned,
      total: breakdown.keywordTotal,
      points: breakdown.keywordPts,
      max: breakdown.keywordMax,
    }),
  };
}

/**
 * The biggest lever in the formula, and until now visible only when it bit:
 * "capped at 30" appeared, and a candidate one keyword away from that cap had
 * no way to see it coming.
 */
function coreStackLine({ breakdown, keywords }: LinesInput): ScoreLine | null {
  const label = t('score.label.coreStack');
  if (breakdown.primaryTotal === 0) return { label, text: t('score.coreStack.none') };
  const primaries = keywords.filter((k) => k.primary);
  const have = primaries.filter((k) => k.status === 'present' || k.status === 'add');
  const missing = primaries.filter((k) => k.status !== 'present' && k.status !== 'add');
  const names = (list: MatchKeyword[]) => list.map((k) => k.term).join(' · ');
  if (breakdown.cap === null) {
    return {
      label,
      text: primaries.length > 0 ? t('score.coreStack.allPresent', { names: names(have) }) : t('score.coreStack.covered'),
      tone: 'ok',
    };
  }
  return {
    label,
    text:
      missing.length > 0
        ? t('score.coreStack.missing', { names: names(missing), cap: breakdown.cap })
        : t('score.coreStack.partial', { present: breakdown.primaryPresent, total: breakdown.primaryTotal, cap: breakdown.cap }),
    tone: 'danger',
    title: t('score.coreStack.title'),
  };
}

/** The three places a recruiter reads in their first six seconds. */
function firstGlanceLine({ breakdown }: LinesInput): ScoreLine | null {
  const a = breakdown.alignment;
  if (!a) return null;
  const grades = [a.title, a.summary, a.recent_role];
  const weak = GLANCE.filter((_, i) => grades[i] !== 'strong');
  return {
    label: t('score.label.firstGlance'),
    // One sentence per set of weak places ("title and recent role could be sharper"): the message picks it by `which`.
    text: weak.length === 0 ? t('score.firstGlance.allStrong') : t('score.firstGlance.weak', { which: weak.join('_') }),
    tone: weak.length === 0 ? 'ok' : 'warn',
    title: t('score.firstGlance.title', { title: a.title, summary: a.summary, role: a.recent_role }),
  };
}

/**
 * A term named on a skills line and one shown inside a bullet with a number
 * read completely differently to a human, and nothing measured the difference
 * before `evidence` (v1.70.0). Since v6 the score does too, a little.
 */
function shownAtWorkLine({ breakdown, keywords }: LinesInput): ScoreLine | null {
  const wanted = keywords.filter(
    (k) => k.status === 'present' && effectiveRequirement(k) !== 'context' && k.evidence !== undefined,
  );
  if (wanted.length === 0) return null;
  const listed = wanted.filter((k) => k.evidence === 'listed');
  if (listed.length === 0) {
    return { label: t('score.label.shownAtWork'), text: t('score.shown.all', { n: wanted.length }), tone: 'ok' };
  }
  const terms = listed.map((k) => k.term).join(', ');
  return {
    label: t('score.label.shownAtWork'),
    text: t('score.shown.some', { shown: wanted.length - listed.length, total: wanted.length, listed: listed.length }),
    tone: 'warn',
    title:
      breakdown.v >= EVIDENCE_SCORED_FROM
        ? t('score.shown.titleScored', { terms, percent: Math.round(SCORING.listedCredit * 100) })
        : t('score.shown.title', { terms }),
  };
}

/** Gates the score never touched: the thing that stops an application on its own. */
function toConfirmLine({ hard }: LinesInput): ScoreLine | null {
  const failed = hard.filter((h) => h.status === 'fail');
  const unknown = hard.filter((h) => h.status === 'unknown');
  if (failed.length === 0 && unknown.length === 0) {
    return hard.length === 0 ? null : { label: t('score.label.hard'), text: t('score.hard.allMet', { n: hard.length }), tone: 'ok' };
  }
  const counts = { failed: failed.length, unknown: unknown.length };
  return {
    label: t('score.label.toConfirm'),
    text: t(unknown.length === 0 ? 'score.confirm.failed' : failed.length === 0 ? 'score.confirm.unknown' : 'score.confirm.both', counts),
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
  return !input.keywords.some(
    (k) => k.status === 'present' && k.evidence === 'listed' && effectiveRequirement(k) === 'must' && !groupMet(input.keywords, k, shownAtWork),
  );
}

/**
 * An either/or group ("Express, Fastify or NestJS") is ONE requirement (ADR 0044):
 * once another member answers it, this one asks for nothing. `foldGroups` scores
 * it so; the advice named NestJS "a must nothing backs" beside Express and
 * Fastify, a gap the number did not have (found 2026-09-30).
 */
function groupMet(keywords: MatchKeyword[], k: MatchKeyword, answers: (other: MatchKeyword) => boolean): boolean {
  const group = k.group?.trim().toLowerCase();
  return !!group && keywords.some((o) => o !== k && o.group?.trim().toLowerCase() === group && answers(o));
}

const written = (k: MatchKeyword): boolean => k.status === 'present';
const claimable = (k: MatchKeyword): boolean => k.status === 'present' || k.status === 'add';
const shownAtWork = (k: MatchKeyword): boolean => k.status === 'present' && (k.evidence === 'described' || k.evidence === 'measured');

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

/** The one sentence, and whose words it is: ours, in the reader's language, or the model's own. */
export interface Advice {
  text: string;
  modelWritten: boolean;
}

export function mainAdvice(input: AdviceInput): string | null {
  return adviceLine(input)?.text ?? null;
}

export function adviceLine(input: AdviceInput): Advice | null {
  const ruled = ruledAdvice(input);
  if (ruled !== null) return { text: ruled, modelWritten: false };
  const { actions } = input;
  const edit = actions.find((a) => a.priority === 'high') ?? actions[0];
  if (!edit) return null;
  const what = clipWords(edit.what, MAX_ADVICE_CHARS);
  // Every other rung is a sentence; the model's clause becomes one here
  // rather than sitting among them without a stop.
  return what === '' ? null : { text: `${openingCase(what)}${/[.!?…]$/.test(what) ? '' : '.'}`, modelWritten: true };
}

/** Every rung but the last: the ones this file words itself, from verdicts already stored. */
function ruledAdvice({ breakdown, keywords, hard }: AdviceInput): string | null {
  const failed = hard.find((h) => h.status === 'fail');
  if (failed) return t('score.advice.gateFailed', { gate: clipWords(failed.requirement, MAX_GATE_CHARS) });

  // The cap is the biggest lever in the formula and the only one no edit
  // moves: without a word of the core stack, every other improvement is
  // arithmetic under a ceiling.
  if (breakdown.cap !== null && breakdown.primaryPresent === 0) {
    const missing = keywords
      .filter((k) => k.primary && k.status !== 'present' && k.status !== 'add')
      .map((k) => k.term);
    const [first, second] = missing;
    const cap = breakdown.cap;
    if (first === undefined) return t('score.advice.coreMissing', { cap });
    if (second === undefined) return t('score.advice.coreOne', { term: first, cap });
    // Naming two of five and calling those two "the core stack" would be a
    // false statement, so the ones that did not fit are counted, not dropped.
    const rest = missing.length - MAX_NAMED_TERMS;
    return rest > 0 ? t('score.advice.coreMore', { first, second, rest, cap }) : t('score.advice.coreTwo', { first, second, cap });
  }

  const unanswered = hard.find((h) => h.status === 'unknown');
  if (unanswered) return t('score.advice.gateUnknown', { gate: clipWords(unanswered.requirement, MAX_GATE_CHARS) });

  const musts = keywords.filter((k) => effectiveRequirement(k) === 'must');

  // "add" means the resume's own facts already evidence the term and the word
  // itself is missing — the cheapest points on the page, and the only rung
  // that asks for nothing but typing.
  const unwritten = musts.find((k) => k.status === 'add' && !groupMet(keywords, k, written));
  if (unwritten) return t('score.advice.unwritten', { term: unwritten.term });

  const unbacked = musts.find((k) => (k.status === 'ask_user' || k.status === 'cannot_claim') && !groupMet(keywords, k, claimable));
  if (unbacked) return t('score.advice.unbacked', { term: unbacked.term });

  // Named on a skills line and never shown at work: the score discounts it a
  // little (v6), a human reads it as a claim with nothing behind it (evidence.ts).
  const listed = musts.filter((k) => k.status === 'present' && k.evidence === 'listed' && !groupMet(keywords, k, shownAtWork));
  const first = listed[0];
  if (first) {
    return listed.length === 1
      ? t('score.advice.listedOne', { term: first.term })
      : t('score.advice.listedMany', { term: first.term, n: listed.length });
  }

  const alignment = breakdown.alignment;
  if (alignment) {
    // A grade below `strong` is the gap; `strong` never reaches the sentence.
    const weak = [
      { where: 'title', grade: alignment.title },
      { where: 'summary', grade: alignment.summary },
      { where: 'role', grade: alignment.recent_role },
    ].find((g) => g.grade !== 'strong');
    if (weak) return t('score.advice.sharpen', weak);
  }

  return null;
}
