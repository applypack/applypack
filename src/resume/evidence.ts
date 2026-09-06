import type { KeywordMatcher } from './keyword-matcher';
import type { MatchKeyword } from './prompts';

/*
 * How strongly the resume evidences a keyword, computed from the text rather
 * than asked of the model (ADR 0012's rule, applied to the one thing the model
 * was previously guessing at in prose). The idea is the four-level evidence
 * scale from the Resume ↔ Job Intelligence analysis, §23:
 *
 *   listed     the term is on a list of terms — a skills line
 *   described  the term appears inside a sentence about work that was done
 *   measured   that sentence also carries a number
 *
 * The distinction is the difference between a resume that SAYS "AWS" and one
 * that says "migrated 14 services to AWS ECS, cutting infrastructure cost 23%".
 * A recruiter reads them completely differently, and until now the product had
 * no way to tell them apart: `status: present` covered both.
 *
 * It is read by the page (so a keyword can say where it lives) and by the
 * suggestion rules, whose REQUIRED COVERAGE floor already wanted to know which
 * must-level terms live only in a skills list. It does NOT feed the score —
 * one scoring change at a time, and this one wants measuring first.
 *
 * Pure: the matcher and the text arrive as arguments.
 */

export const EVIDENCE_LEVELS = ['absent', 'listed', 'described', 'measured'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/** Separators a resume uses between terms on one line. */
const SEPARATORS = [',', ' · ', ' | ', ';', ' • '];
/**
 * A number that means something: a percentage, money, a magnitude, a duration,
 * a count of things. A bare year ("2019") or a version ("Vue 3") is not impact.
 */
const METRIC =
  /\d+\s*%|[$€£]\s?\d|\b\d[\d,.]*\s*(?:k|m|bn|b|x|ms|s|gb|tb|qps|rps|hrs?|hours?|days?|weeks?|months?|users?|customers?|requests?|events?|services?|engineers?|people|clients?|sites?|websites?)\b/i;

/** The line a span sits on. */
function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

/**
 * Is this line a list of terms rather than a sentence? Same shape the editor's
 * `insertIntoSkills` looks for: an optional label, then two or more items with
 * nothing that reads as a sentence.
 */
export function isTermList(line: string): boolean {
  const colon = line.indexOf(':');
  const body = (colon === -1 ? line : line.slice(colon + 1)).trim().replace(/^[-•*]\s*/, '');
  if (body === '') return false;
  // A sentence ends somewhere. A term list does not.
  if (/[.!?](\s|$)/.test(body.slice(0, -1))) return false;
  for (const sep of SEPARATORS) {
    const parts = body.split(sep).map((p) => p.trim()).filter(Boolean);
    // Items, not clauses: three words each at most is what a skills line looks like.
    if (parts.length >= 2 && parts.every((p) => p.split(/\s+/).length <= 4)) return true;
  }
  return false;
}

/** The strongest evidence the resume offers for one term. */
export function evidenceFor(
  keyword: Pick<MatchKeyword, 'term' | 'aliases'>,
  resumeText: string,
  matcher: Pick<KeywordMatcher, 'findTerm'>,
): EvidenceLevel {
  const spans = matcher.findTerm(resumeText, keyword.term, keyword.aliases ?? []);
  let best: EvidenceLevel = 'absent';
  for (const span of spans) {
    const line = lineAt(resumeText, span.start);
    const level: EvidenceLevel = isTermList(line) ? 'listed' : METRIC.test(line) ? 'measured' : 'described';
    if (EVIDENCE_LEVELS.indexOf(level) > EVIDENCE_LEVELS.indexOf(best)) best = level;
  }
  return best;
}

export interface EvidenceReport {
  keywords: MatchKeyword[];
  /** How many of the wanted terms live only on a list of terms — the "invisible skills" count. */
  listedOnly: number;
}

/** Stamps `evidence` on every keyword the resume shows. */
export function annotateEvidence(
  keywords: MatchKeyword[],
  resumeText: string,
  matcher: Pick<KeywordMatcher, 'findTerm'>,
): EvidenceReport {
  let listedOnly = 0;
  const next = keywords.map((k) => {
    const evidence = evidenceFor(k, resumeText, matcher);
    if (evidence === 'listed') listedOnly++;
    return { ...k, evidence };
  });
  return { keywords: next, listedOnly };
}
