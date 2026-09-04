/*
 * The manual path out of a comparison: the wording a suggestion proposes, and
 * the whole suggestion list as Markdown the user can paste into Word, Google
 * Docs or a mail. Pure — no I/O, no DOM. The card renders `proposalOf` as its
 * "Proposed" block and `suggestionSheet` into the Copy button's payload, so
 * the sheet needs no JavaScript to work.
 *
 * The model writes the proposal inside the `what` sentence rather than in a
 * field of its own (a field arrives in stage 3 as `replacement`, and is
 * preferred here the day it does). Every rule below was measured against the
 * 209 stored actions — see the branch's pre-work note.
 */

import type { MatchAction, MatchRemoval } from './prompts';

/**
 * Shorter quoted runs are term mentions, not wordings: the corpus quotes
 * `'|'`, `"Node"`, `"nginx"` and `'CloudWath'` to name them, never to propose
 * them. It costs one real proposal in 209 (`Reduce to 'Austin, TX'`).
 */
const MIN_PROPOSAL = 12;
/** A label, not a sentence: anything longer is the instruction, which the card already shows. */
const MAX_VERB = 24;

/** "Change 'A' to 'B'": the wording AFTER the connective is the proposal, the one before it is today's text. */
const SWAP = /\s(?:with|to|instead of)\s/gi;
const REPLACE_OPENER = /^(?:replace|change|swap)\b/i;
const WORDLIKE = /[A-Za-z0-9]/;

/** Curly quotes to straight, tabs to spaces — one character for one, so indexes still line up. */
function fold(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[\t ]/g, ' ');
}

interface Span {
  start: number;
  end: number;
  text: string;
}

/**
 * Runs of `text` between two `quote` characters. A straight single quote is
 * also an apostrophe, so an opener may not follow a word character
 * (`posting's`) and a closer flanked by word characters is skipped as
 * word-internal (`you're`).
 */
function quotedSpans(text: string, quote: string): Span[] {
  const spans: Span[] = [];
  const apostrophe = quote === "'";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== quote) continue;
    if (apostrophe && WORDLIKE.test(text[i - 1] ?? '')) continue;
    let close = text.indexOf(quote, i + 1);
    while (
      close !== -1 &&
      apostrophe &&
      WORDLIKE.test(text[close - 1] ?? '') &&
      WORDLIKE.test(text[close + 1] ?? '')
    ) {
      close = text.indexOf(quote, close + 1);
    }
    if (close === -1) break;
    spans.push({ start: i + 1, end: close, text: text.slice(i + 1, close) });
    i = close;
  }
  return spans;
}

export interface Proposal {
  /** The wording itself — what Copy puts on the clipboard. */
  text: string;
  /** How the model introduced it ("Rewrite", "Add", "Change"), or null when the lead was a sentence. */
  verb: string | null;
}

/**
 * The wording an action proposes, or null when `what` is an instruction with
 * no quoted wording in it ("Cut to four bullets", "Add a number").
 */
export function proposalOf(action: Pick<MatchAction, 'what'> & { replacement?: unknown }): Proposal | null {
  // Stage 3 gives the model a field of its own; when it is there, nothing is parsed.
  if (typeof action.replacement === 'string' && action.replacement.trim()) {
    return { text: action.replacement.trim(), verb: 'Replace' };
  }
  const what = fold(action.what ?? '');
  const all = [...quotedSpans(what, '"'), ...quotedSpans(what, "'")].sort((a, b) => a.start - b.start);
  let candidates = all.filter((s) => s.text.trim().length >= MIN_PROPOSAL);
  const first = all[0];
  const firstCandidate = candidates[0];
  if (!first || !firstCandidate) return null;

  const connectives = [...what.matchAll(SWAP)].map((m) => m.index);
  const cut = connectives.filter(
    (i) => candidates.some((s) => s.end <= i) && candidates.some((s) => s.start > i),
  ).at(-1);
  if (cut !== undefined) {
    candidates = candidates.filter((s) => s.start > cut);
  } else if (
    REPLACE_OPENER.test(what.trimStart()) &&
    connectives.some((i) => i >= firstCandidate.end && i <= firstCandidate.end + 2)
  ) {
    // "Replace 'the old line' with a specific version: …" — the quote is today's text.
    return null;
  }

  const [best] = candidates.sort((a, b) => b.text.trim().length - a.text.trim().length || b.start - a.start);
  if (!best) return null;
  const lead = what
    .slice(0, first.start - 1)
    .replace(/[:,\s]+$/, '')
    .replace(/\s+(?:as|to|with|into|like)$/i, '')
    .trim();
  return {
    text: best.text.trim(),
    verb: lead && lead.length <= MAX_VERB && !lead.includes('.') ? lead : null,
  };
}

export interface SheetHeading {
  jobTitle: string;
  companyName: string;
  resumeName: string;
}

function block(lines: (string | null)[]): string {
  return lines.filter((l): l is string => l !== null).join('\n');
}

/** One entry: what the resume says now, what to make it say, and why. */
function entry(
  index: number,
  item: { section: string; where: string; what: string; why: string; quote?: string | null },
  proposal: Proposal | null,
  removal: boolean,
): string {
  return block([
    `### ${index}. ${item.where} — ${item.section}${removal ? ' (remove)' : ''}`,
    '',
    item.what,
    item.quote ? '' : null,
    item.quote ? `**Now:**\n\n> ${item.quote.split('\n').join('\n> ')}` : null,
    proposal ? '' : null,
    proposal ? `**${proposal.verb ?? 'Proposed'}:**\n\n> ${proposal.text.split('\n').join('\n> ')}` : null,
    '',
    `_Why: ${item.why}_`,
  ]);
}

/**
 * The whole suggestion list as Markdown — the universal manual path. Nothing
 * here is applied for the user; it is the list they take to whatever editor
 * their resume actually lives in.
 */
export function suggestionSheet(
  heading: SheetHeading,
  actions: MatchAction[],
  removals: MatchRemoval[],
): string {
  const parts: string[] = [
    `# Resume changes — ${heading.jobTitle} at ${heading.companyName}`,
    '',
    `Resume: ${heading.resumeName}`,
  ];
  if (actions.length > 0) {
    parts.push('', `## What to change (${actions.length})`, '');
    actions.forEach((a, i) => parts.push(entry(i + 1, a, proposalOf(a), false), ''));
  }
  if (removals.length > 0) {
    parts.push('', `## What to remove (${removals.length})`, '');
    removals.forEach((r, i) => parts.push(entry(i + 1, r, null, true), ''));
  }
  if (actions.length === 0 && removals.length === 0) parts.push('', 'No edits suggested.');
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
