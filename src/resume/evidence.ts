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

/** The line a span sits on, and where on it. */
export function lineAt(text: string, index: number): { line: string; column: number } {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return { line: text.slice(start, end === -1 ? text.length : end), column: index - start };
}

/**
 * The part of a line around one position. A .docx skills table comes out of
 * the reader as ONE line — the label cell, " | ", the values cell — and a
 * whole row read as a sentence made every term on it look like work done.
 * Judged cell by cell, the values cell is the list of terms it is.
 */
export function segmentAt(line: string, column: number): string {
  let start = 0;
  let end = line.length;
  for (const sep of [' | ', '\t']) {
    const left = line.lastIndexOf(sep, column - 1);
    const right = line.indexOf(sep, column);
    if (left !== -1) start = Math.max(start, left + sep.length);
    if (right !== -1) end = Math.min(end, right);
  }
  return line.slice(start, end);
}

/** Words a list of terms has no use for: a sentence has grammar, a skills line has none. */
const GRAMMAR = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'by', 'at', 'from', 'that', 'this', 'as', 'is', 'was', 'were', 'are']);

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
  // And a sentence has grammar: more than one small word in five is prose ("Docker and Kubernetes" is still a list).
  const words = body.split(/\s+/);
  if (words.filter((w) => GRAMMAR.has(w.toLowerCase())).length * 5 > words.length) return false;
  for (const sep of SEPARATORS) {
    const parts = body.split(sep).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    // Items, not clauses: three words each at most is what a skills line looks like. A long list may glue a
    // few pairs where a table's rows were flattened ("CSS3 Node.js"), so four short items in five is enough there.
    const short = parts.filter((p) => p.split(/\s+/).length <= 4).length;
    if (short === parts.length || (parts.length >= 6 && short * 5 >= parts.length * 4)) return true;
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
    const at = lineAt(resumeText, span.start);
    const line = segmentAt(at.line, at.column);
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
