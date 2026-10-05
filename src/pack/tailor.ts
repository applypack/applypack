import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { annotateEvidence } from '../resume/evidence';
import { anchorStatuses } from '../resume/keyword-anchor';
import type { KeywordMatcher } from '../resume/keyword-matcher';
import { effectiveKeywords } from '../resume/keyword-overrides';
import { hasContactDetail } from '../resume/parse-warnings';
import type { MatchKeyword } from '../resume/prompts';
import { countableFlags } from '../resume/red-flags';
import { scoreMatch, type MatchAlignment, type ScoreBreakdown } from '../resume/score';
import type { EditOperation, EditPlan, SkillTerm } from './policy';

/*
 * A plan of edits (policy.ts) run on a resume's text with nobody watching:
 * the editor's own operations, the score of the text they leave, and the
 * checks that say whether the result may be kept. No AI anywhere — the
 * wording was written and gated when the comparison was stored (ADR 0037).
 */

export interface EditOutcome {
  text: string;
  done: { key: string; kind: string }[];
  failed: { key: string; kind: string; error: string }[];
}

/** src/web/public/apply-all.mjs — what the Tailor page's "Apply all" runs. */
export interface Editor {
  applyAll(text: string, ops: EditOperation[]): EditOutcome;
  addKeywords(text: string, terms: SkillTerm[]): EditOutcome;
}

// A file URL, as keyword-matcher.ts explains.
const MODULE_URL = pathToFileURL(path.resolve('src/web/public/apply-all.mjs')).href;

let editor: Promise<Editor> | undefined;

export function loadEditor(): Promise<Editor> {
  editor ??= import(MODULE_URL) as Promise<Editor>;
  return editor;
}

/** The cards first, then the keywords onto the text they left: a rewritten bullet may already carry one. */
export function tailor(text: string, plan: EditPlan, edit: Editor): EditOutcome {
  const cards = edit.applyAll(text, plan.ops);
  const words = edit.addKeywords(cards.text, plan.terms);
  return { text: words.text, done: [...cards.done, ...words.done], failed: [...cards.failed, ...words.failed] };
}

/**
 * The comparison's score on another text, as the stored one was computed
 * (match.ts): the text settles what is written (ADR 0045) and how strongly
 * (ADR 0058). The three alignment grades are the model's reading of the
 * analysed text and stay as they were, so a better title line earns nothing
 * here — the number is a floor for what the next analysis will say.
 */
export function scoreOnText(
  text: string,
  report: { keywords: MatchKeyword[]; redFlags: string[]; alignment: MatchAlignment | null },
  matcher: KeywordMatcher,
): ScoreBreakdown {
  const keywords = annotateEvidence(anchorStatuses(report.keywords, text, matcher).keywords, text, matcher).keywords;
  const flags = countableFlags(report.redFlags, keywords, matcher);
  return scoreMatch(effectiveKeywords(keywords), report.alignment, flags.counted.length);
}

export type TailorCheck = 'contact-changed' | 'line-lost' | 'score-dropped';

const filledLines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
/** A line's words alone: a quote is found past wrapping and punctuation (target.mjs:locateQuote), so it is compared that way. */
const wordsOf = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * What must hold before an unattended edit is kept, read off the two texts
 * and trusting nothing about how the second was made: the contact lines stand
 * as they were, every line that is gone is one the plan quoted (a line a
 * keyword was appended to still stands inside its longer self), and the score
 * did not fall.
 */
export function tailorChecks(input: {
  before: string;
  plan: EditPlan;
  outcome: EditOutcome;
  score: { before: number; after: number };
}): TailorCheck[] {
  const after = filledLines(input.outcome.text);
  const gone = filledLines(input.before).filter((line) => !after.some((a) => a.includes(line)));
  const done = new Set(input.outcome.done.map((d) => d.key));
  const quoted = input.plan.ops.flatMap((op) => ('quote' in op && done.has(op.key) ? wordsOf(op.quote) : [])).filter((q) => q !== '');
  // A quote may cover several wrapped lines, or a few words inside one.
  const planned = (line: string): boolean => {
    const words = wordsOf(line);
    return words === '' || quoted.some((q) => q.includes(words) || words.includes(q));
  };
  const failed: TailorCheck[] = [];
  if (gone.some(hasContactDetail)) failed.push('contact-changed');
  if (!gone.every(planned)) failed.push('line-lost');
  if (input.score.after < input.score.before) failed.push('score-dropped');
  return failed;
}
