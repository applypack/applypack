import { canonicalTerm } from './facts';
import { effectiveRequirement } from './keyword-overrides';
import type { MatchKeyword } from './prompts';

/*
 * Persist-time guard on what a keyword may BE (ADR 0044 addendum). The list is
 * scored, highlighted in both panes, and turned into "+ add" chips that offer
 * to type the term into the user's skills line — so a row that is not a term
 * is not merely noise, it is bad advice with a number attached.
 *
 * Measured on the live corpus (42 distinct keywords over six comparisons):
 * twelve were not terms at all. Two were gates wearing a keyword's clothes —
 * "5+ years of experience" and "Bachelor's Degree", both `must`, both worth
 * three weighted units, both offered to the user as something to add to their
 * skills. The rest were sentence fragments the extractor had cut out of a
 * responsibility line: "0 to 1", "troubleshoot", "landing pages".
 *
 * The prompt now defines a keyword by what a recruiter would type into a
 * search box. This is the floor under that rule: shapes no wording can make
 * into a term, rejected in code where the score can see them. It is
 * deliberately narrow — a judgment call belongs to the model, a malformed
 * shape does not.
 */

export interface ShapeReport {
  keywords: MatchKeyword[];
  /** Terms dropped, with the rule that dropped each — the regression metric. */
  dropped: { term: string; reason: string }[];
}

/** must > preferred > nice > context, for deciding which duplicate survives. */
const LEVEL_RANK: Record<string, number> = { must: 3, preferred: 2, nice: 1, context: 0 };

/**
 * One name for one thing. Case, separators and a trailing plural are noise
 * ("301 redirects" / "301 redirect", "Node.js" / "node js"), and the alias
 * table already says which spellings mean the same technology — so the key is
 * the first name in that whole set, and two keywords sharing one collapse.
 * `#` and `+` survive, because they are the difference between C, C# and C++.
 */
function dedupeKey(k: MatchKeyword): string {
  const fold = (s: string) =>
    canonicalTerm(s)
      .replace(/[^a-z0-9#+]/g, '')
      .replace(/(?<=[a-z]{3})s$/, '');
  return [fold(k.term), ...k.aliases.map(fold)].filter(Boolean).sort()[0] ?? canonicalTerm(k.term);
}

/** "5+ years", "at least 3 yrs" — a requirement about the person, not a skill. */
const YEARS = /\b\d+\s*\+?\s*(years?|yrs?)\b/i;
/** A degree requirement. Needs the degree noun, so "Solutions Architect – Associate" survives. */
const DEGREE = /\b(?:degree|diploma|phd|doctorate|b\.?sc|m\.?sc|mba)\b|\b(?:bachelor|master|associate)(?:'?s)?\s+(?:degree|of|in)\b/i;
/** A bare quantity: "0", "1", "10x", "2.5". Not a thing anyone searches for. */
const QUANTITY = /^\d+(?:\.\d+)?[a-z]?$/i;
/** Filler that cannot be the substance of a term, so "0 to 1" is not saved by its "to". */
const FILLER = /^(?:to|from|and|or|of|in|the|a|an|with|for|per|up|at|by|on)$/i;
const MAX_WORDS = 5;

function reject(term: string): string | null {
  const t = term.trim();
  if (t.length === 0) return 'empty';
  // Words, not tokens: a dash in "AWS Certified Solutions Architect – Associate"
  // is punctuation, and counting it would drop a real certification.
  const parts = t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (parts.length > MAX_WORDS) return 'longer than a term';
  if (YEARS.test(t)) return 'a years-of-experience requirement — a gate, not a skill';
  if (DEGREE.test(t)) return 'an education requirement — a gate, not a skill';
  // "0 to 1" and "3-5" are quantities the posting used in a sentence; "B2B",
  // "C++" and "SOC 2" carry a token that is neither filler nor a bare number.
  const words = t.split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean);
  if (!words.some((w) => !FILLER.test(w) && !QUANTITY.test(w))) return 'a quantity, not a thing to search for';
  return null;
}

/**
 * Drops the rows that are not terms, then the rows that are the same term
 * twice. Pure. A keyword the user added themselves is never dropped: they
 * typed it, they meant it (keyword-overrides.ts §5).
 *
 * The duplicate pass is not cosmetic. A live Drupal posting produced both
 * "301 redirects" and "301 redirect" in one list, and every keyword carries
 * weight — the same requirement counted twice moves the denominator and the
 * user is offered the same chip twice. `dedupeKey` folds case, separators, a
 * trailing plural and every spelling the alias table knows; the survivor is the
 * one the posting asks harder for.
 */
export function dropMalformedKeywords(keywords: MatchKeyword[]): ShapeReport {
  const dropped: { term: string; reason: string }[] = [];
  const shaped = keywords.filter((k) => {
    if (k.override?.added) return true;
    const reason = reject(k.term);
    if (reason) dropped.push({ term: k.term, reason });
    return reason === null;
  });

  const strongest = new Map<string, MatchKeyword>();
  for (const k of shaped) {
    const key = dedupeKey(k);
    const held = strongest.get(key);
    if (!held) {
      strongest.set(key, k);
      continue;
    }
    const better =
      (LEVEL_RANK[effectiveRequirement(k)] ?? 0) > (LEVEL_RANK[effectiveRequirement(held)] ?? 0) ||
      (k.primary && !held.primary);
    dropped.push({ term: better ? held.term : k.term, reason: `the same term as "${better ? k.term : held.term}"` });
    if (better) strongest.set(key, { ...k, primary: k.primary || held.primary });
    else strongest.set(key, { ...held, primary: held.primary || k.primary });
  }
  // Order is the posting's, not the map's: the panes read it top to bottom.
  const seen = new Set<string>();
  const out: MatchKeyword[] = [];
  for (const k of shaped) {
    const key = dedupeKey(k);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(strongest.get(key) ?? k);
  }
  return { keywords: out, dropped };
}
