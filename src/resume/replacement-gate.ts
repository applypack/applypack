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
 *    for that case.
 *  - KEEP WANTED KEYWORDS in code: a replacement that loses a must-have or
 *    primary keyword the quote had is blocked (the score reads exactly those);
 *    a lost nice-to-have or a paraphrased phrase keeps the wording and gets a
 *    note, because 11 of the 21 as-specified drops were wrong.
 *
 * A blocked action keeps everything but its replacement, which becomes an
 * explicit null — proposalOf reads that as "judged, do not parse `what`".
 */

import { factCheck } from './fact-check';
import type { FactLike } from './facts';
import { effectiveRequirement } from './keyword-overrides';
import type { KeywordMatcher } from './keyword-matcher';
import { toPlainPunctuation, type MatchAction, type MatchKeyword } from './prompts';

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
  const has = (text: string, k: MatchKeyword) => sources.matcher.findTerm(text, k.term, k.aliases ?? []).length > 0;

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
      if (introduced && k.status === 'cannot_claim') blocks.push(`claims "${k.term}", which this resume has no evidence for`);
      else if (introduced && k.status === 'ask_user') warns.push(`says "${k.term}" — confirm you have it first`);
      // KEEP WANTED KEYWORDS: only a change can lose a keyword; an addition replaces nothing.
      if (quote && k.status === 'present' && has(quote, k) && !has(text, k)) {
        if (k.primary || effectiveRequirement(k) === 'must') blocks.push(`drops "${k.term}", a must-have this posting wants`);
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
