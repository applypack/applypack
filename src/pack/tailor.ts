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

/** What one applied operation changed, as the editor recorded it (text-edits.mjs) — its Undo. */
export interface InverseEdit {
  start: number;
  removed: string;
  inserted: string;
}

export interface EditOutcome {
  text: string;
  done: { key: string; kind: string; edit: InverseEdit }[];
  failed: { key: string; kind: string; error: string }[];
}

/** The Tailor page's own "Apply all" and Undo (src/web/public/apply-all.mjs, text-edits.mjs). */
export interface Editor {
  applyAll(text: string, ops: EditOperation[]): EditOutcome;
  addKeywords(text: string, terms: SkillTerm[]): EditOutcome;
  undoEdit(text: string, edit: InverseEdit): { text: string } | { error: string };
}

// File URLs, as keyword-matcher.ts explains.
const moduleUrl = (name: string): string => pathToFileURL(path.resolve('src/web/public', name)).href;

let editor: Promise<Editor> | undefined;

export function loadEditor(): Promise<Editor> {
  editor ??= Promise.all([
    import(moduleUrl('apply-all.mjs')) as Promise<Pick<Editor, 'applyAll' | 'addKeywords'>>,
    import(moduleUrl('text-edits.mjs')) as Promise<Pick<Editor, 'undoEdit'>>,
  ]).then(([batch, edits]) => ({ applyAll: batch.applyAll, addKeywords: batch.addKeywords, undoEdit: edits.undoEdit }));
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

export type TailorCheck = 'unexplained-change' | 'beyond-quote' | 'contact-changed' | 'score-dropped';

/** A span's words alone: a quote is found past wrapping and punctuation (target.mjs:locateQuote), so it is compared that way. */
const wordsOf = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * What must hold before an unattended edit is kept. It trusts neither the
 * plan nor the editor, only the record of what each operation changed:
 *
 *  - taking every change back, last one first, gives the text it started
 *    from to the character — so nothing changed that is not on record;
 *  - a change or a removal took out nothing but words of the span its
 *    suggestion quoted, and an addition or a keyword took out no word at all;
 *  - no email address or phone number was in anything taken out;
 *  - the score did not fall.
 */
export function tailorChecks(
  input: { before: string; plan: EditPlan; outcome: EditOutcome; score: { before: number; after: number } },
  edit: Pick<Editor, 'undoEdit'>,
): TailorCheck[] {
  const { outcome } = input;
  const failed: TailorCheck[] = [];

  let text: string | null = outcome.text;
  for (const done of [...outcome.done].reverse()) {
    const back: { text: string } | { error: string } = text === null ? { error: 'lost' } : edit.undoEdit(text, done.edit);
    text = 'text' in back ? back.text : null;
  }
  if (text !== input.before) failed.push('unexplained-change');

  const quotes = new Map(input.plan.ops.flatMap((op) => ('quote' in op ? [[op.key, wordsOf(op.quote)] as const] : [])));
  if (outcome.done.some((d) => !(quotes.get(d.key) ?? '').includes(wordsOf(d.edit.removed)))) failed.push('beyond-quote');
  if (outcome.done.some((d) => hasContactDetail(d.edit.removed))) failed.push('contact-changed');
  if (input.score.after < input.score.before) failed.push('score-dropped');
  return failed;
}
