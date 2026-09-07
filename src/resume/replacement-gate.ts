/*
 * The gate between the model's replacement wording and the Apply button
 * (ADR 0037). The model proposes; this decides, at persist time and in code,
 * whether a proposal may be applied with one press or has to stay a question.
 * Pure — the sources arrive as arguments, match.ts and suggestions.ts load them.
 *
 * Three checks, each measured on the 108 wordings the model had written before
 * the field existed (branch pre-work note):
 *  - factCheck, exactly as the cover letter runs it — resume, posting and
 *    confirmed facts as sources. The posting is a source on purpose: without it
 *    "B2B SaaS" and "East Coast hours" block as invented employers, and with it
 *    no metric from the posting became supported (0 of 108).
 *  - a replacement may not INTRODUCE a keyword marked cannot_claim for this
 *    posting. factCheck reads tool claims only against CandidateFacts, so a
 *    PHP resume proposing "Node.js services" passes it; this is the honest rule
 *    for that case. One exemption, added with ADR 0044: the posted job title
 *    (priority 2) on the resume's own title line, which names the role being
 *    applied for rather than one already held — blocking it made the single
 *    highest-leverage edit unreachable on every retitle.
 *  - KEEP WANTED KEYWORDS in code: a replacement that loses a must-have or
 *    primary keyword the quote had is blocked (the score reads exactly those);
 *    a lost nice-to-have or a paraphrased phrase keeps the wording and gets a
 *    note, because 11 of the 21 as-specified drops were wrong. A term the
 *    resume still carries OUTSIDE the quoted span is not lost at all and only
 *    warns — the rule as written blocked a good rewrite of a bullet whose one
 *    "SQL" was the phrase "SQL injection".
 *
 * A blocked action keeps everything but its replacement, which becomes an
 * explicit null — proposalOf reads that as "judged, do not parse `what`".
 *
 * `gateRemovals` is the same idea over the delete list, and it exists because
 * the prompt rule alone did not hold: gotcha 11's second lesson was paid for
 * once with prompt text ("PROTECTED contact line", "KEEP WANTED KEYWORDS"),
 * and the model broke it again — a skills line quoted whole to advise dropping
 * three of its six frameworks, with React (must, primary) and Vue.js (must)
 * inside the struck-through span. A removal quote is what the editor deletes
 * with one press, so the two rules are code now:
 *  - the quote may not carry the contact line's email or phone;
 *  - the quote may not carry a keyword this posting wants and this resume has
 *    — a must or primary one blocks, anything lighter warns, exactly as a
 *    replacement that drops the same keyword does.
 * A blocked removal keeps its advice and loses its `quote`: nothing is
 * highlighted, nothing is deletable in one press, and `why` says why.
 */

import { factCheck } from './fact-check';
import type { FactLike } from './facts';
import { effectiveRequirement } from './keyword-overrides';
import type { KeywordMatcher } from './keyword-matcher';
import { hasContactDetail } from './parse-warnings';
import { toPlainPunctuation, type MatchAction, type MatchKeyword, type MatchRemoval } from './prompts';

export interface GateSources {
  resumeText: string;
  /** Title + description: vocabulary the candidate is entitled to use. */
  posting: string;
  /** Every CandidateFact — confirmed ones support a claim, denied ones contradict it. */
  facts: FactLike[];
  /** This comparison's keywords, with their statuses and levels. */
  keywords: MatchKeyword[];
  matcher: Pick<KeywordMatcher, 'findTerm'>;
}

export interface GateReport {
  actions: MatchAction[];
  blocked: number;
  warned: number;
}

export interface RemovalGateReport {
  removals: MatchRemoval[];
  /** Quotes nulled: the advice stayed, the one-press delete did not. */
  blocked: number;
  warned: number;
}

const BLOCK_NOTE = ' · not applied — ';
const WARN_NOTE = ' · check: ';

/** Confirmed facts as lines the fact check can index — the same shape the cover letter feeds it. */
function factLines(facts: FactLike[]): string[] {
  return facts
    .filter((f) => f.status === 'confirmed')
    .map((f) => (f.note ? `${f.term} — ${f.note}` : f.term));
}

export function gateActions(actions: MatchAction[], sources: GateSources): GateReport {
  let blocked = 0;
  let warned = 0;
  const hits = (text: string, k: MatchKeyword) => sources.matcher.findTerm(text, k.term, k.aliases ?? []).length;
  const has = (text: string, k: MatchKeyword) => hits(text, k) > 0;
  /** Does this term still stand somewhere in the resume outside the span being rewritten? */
  const elsewhereInResume = (quote: string, k: MatchKeyword) => hits(sources.resumeText, k) > hits(quote, k);

  const gated = actions.map((action) => {
    if (typeof action.replacement !== 'string' || action.replacement.trim() === '') return action;
    const text = toPlainPunctuation(action.replacement);
    const quote = action.quote ?? '';
    const blocks: string[] = [];
    const warns: string[] = [];

    const check = factCheck({
      text,
      sources: [sources.resumeText, sources.posting, ...factLines(sources.facts)],
      facts: sources.facts,
    });
    if (check.verdict === 'block') blocks.push(...check.reasons);
    else if (check.verdict === 'warn') warns.push(...check.reasons);

    for (const k of sources.keywords) {
      const introduced = !has(quote, k) && has(text, k);
      // The posted job title (priority 2) on the resume's OWN title line or in
      // its summary is the role being applied for, not a claim of having held
      // it — and the retitle is the single highest-leverage edit there is. In a
      // bullet ("Web Developer at Acme") it would be a claim, so the exemption
      // stops at those two sections; every other keyword blocks everywhere.
      const targetTitle = (action.section === 'title' || action.section === 'summary') && k.priority === 2;
      if (introduced && k.status === 'cannot_claim' && !targetTitle) blocks.push(`claims "${k.term}", which this resume has no evidence for`);
      else if (introduced && k.status === 'ask_user' && !targetTitle) warns.push(`says "${k.term}" — confirm you have it first`);
      // KEEP WANTED KEYWORDS: only a change can lose a keyword; an addition
      // replaces nothing. And a term the resume still carries somewhere else is
      // not lost — blocking on that killed a good rewrite of a bullet whose
      // only "SQL" was the phrase "SQL injection".
      if (quote && k.status === 'present' && has(quote, k) && !has(text, k)) {
        if (elsewhereInResume(quote, k)) warns.push(`drops "${k.term}" from this line; the resume still has it elsewhere`);
        else if (k.primary || effectiveRequirement(k) === 'must') blocks.push(`drops "${k.term}", a must-have this posting wants`);
        else warns.push(`drops "${k.term}"`);
      }
    }

    if (blocks.length > 0) {
      blocked++;
      return { ...action, replacement: null, why: `${action.why}${BLOCK_NOTE}${blocks[0]}` };
    }
    if (warns.length > 0) {
      warned++;
      return { ...action, replacement: text, why: `${action.why}${WARN_NOTE}${warns[0]}` };
    }
    return { ...action, replacement: text };
  });

  return { actions: gated, blocked, warned };
}

/**
 * The same judgment over the delete list. A removal has no wording to check,
 * so only the two span rules apply — and both are about what the quote covers,
 * never about whether the advice is good.
 */
export function gateRemovals(removals: MatchRemoval[], sources: GateSources): RemovalGateReport {
  let blocked = 0;
  let warned = 0;
  const has = (text: string, k: MatchKeyword) => sources.matcher.findTerm(text, k.term, k.aliases ?? []).length > 0;

  const gated = removals.map((removal) => {
    const quote = removal.quote?.trim() ?? '';
    if (quote === '') return removal;
    const blocks: string[] = [];
    const warns: string[] = [];

    // PROTECTED: a quote that reaches the email or the phone is never applied,
    // whatever it was aiming at (gotcha 11 — a ZIP code took the email with it).
    if (hasContactDetail(quote)) blocks.push('the span covers contact details — keep the email and phone');

    // KEEP WANTED KEYWORDS: deleting the span deletes the evidence with it.
    for (const k of sources.keywords) {
      if (k.status !== 'present' && k.status !== 'add') continue;
      if (!has(quote, k)) continue;
      if (k.primary || effectiveRequirement(k) === 'must') blocks.push(`the span covers "${k.term}", a must-have this posting wants`);
      else warns.push(`the span covers "${k.term}", which this posting asks for`);
    }

    if (blocks.length > 0) {
      blocked++;
      return { ...removal, quote: null, why: `${removal.why}${BLOCK_NOTE}${blocks[0]}` };
    }
    if (warns.length > 0) {
      warned++;
      return { ...removal, why: `${removal.why}${WARN_NOTE}${warns[0]}` };
    }
    return removal;
  });

  return { removals: gated, blocked, warned };
}
