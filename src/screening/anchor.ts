import { normaliseForAnchor } from '../resume/structure-anchor';
import { isTermList } from '../resume/evidence';
import type { KeywordMatcher } from '../resume/keyword-matcher';
import type { Rubric, RubricTerm } from './rubric';
import { EVIDENCE_RUNGS, type EvidenceRung, type ScreenReply, type ScreenTermRow } from './prompts';

/*
 * The persist-time guard for a screening reply (ADR 0047): every quote the
 * model gave is checked against the redacted text, and a rung the text
 * cannot show is lowered to what the text can. The same principle as
 * keyword-anchor.ts and structure-anchor.ts on the candidate side — the
 * text outranks the model — applied where it matters most: a score a
 * person will act on has to be readable off the resume it came from.
 *
 * Rules, in the order the table shows them:
 * - the RUBRIC is the frame: a term the model skipped gets a row from the
 *   text alone, a term the model invented is dropped;
 * - a rung above "listed" needs a located quote; without one the rung falls
 *   to what the text shows (a skills line → listed, a work sentence → role),
 *   and a term the matcher cannot find at all is absent;
 * - the text also RAISES: a term the model left at "listed" or "absent" that
 *   the matcher finds inside a sentence about work is "role", quoting that
 *   line — measured on the first live batch, the model quoted the skills
 *   line for Playwright under a bullet that shipped a Playwright suite;
 * - a gate's pass or fail needs a located quote, else it is unknown — the
 *   table shows the quote next to the mark, and a mark with no quote is a
 *   claim the person cannot check;
 * - a role's position, dates and employer must be in the text or the role
 *   goes; an impact "strong" with no surviving quote is "ok".
 *
 * Pure: text, reply, rubric and the matcher in; reply and a report out.
 */

export interface AnchorReport {
  /** Quotes the text did not contain, now null. */
  quotesDropped: number;
  /** Term rungs lowered because their evidence was not in the text. */
  rungsLowered: number;
  /** Term rungs raised because the text shows the term in a work sentence the model did not credit. */
  rungsRaised: number;
  /** Rubric terms the model skipped, filled from the text alone. */
  termsFilled: number;
  /** Reply rows for terms the rubric never named. */
  termsDropped: number;
  /** Gates whose pass / fail had no quote and became unknown. */
  gatesUnproven: number;
  /** Roles dropped for a position or a date the text does not carry. */
  rolesDropped: number;
}

type Matcher = Pick<KeywordMatcher, 'findTerm' | 'locateQuote'>;

/** A verbatim span of the text, after the anchor normalisation, or not. */
export function inText(haystack: string, value: string | null | undefined): boolean {
  if (!value) return false;
  const needle = normaliseForAnchor(value);
  return needle.length > 0 && haystack.includes(needle);
}

const canonical = (s: string): string => s.trim().toLowerCase();

export function anchorScreenReply(
  reply: ScreenReply,
  text: string,
  rubric: Rubric,
  matcher: Matcher,
): { reply: ScreenReply; report: AnchorReport } {
  const report: AnchorReport = { quotesDropped: 0, rungsLowered: 0, rungsRaised: 0, termsFilled: 0, termsDropped: 0, gatesUnproven: 0, rolesDropped: 0 };
  const hay = normaliseForAnchor(text);

  const located = (quote: string | null): string | null => {
    if (quote === null) return null;
    if (matcher.locateQuote(text, quote) !== null || inText(hay, quote)) return quote;
    report.quotesDropped++;
    return null;
  };
  const fromText = (t: RubricTerm): { rung: EvidenceRung; quote: string | null } => textEvidence(t, text, matcher);
  const anchorTerms = (rows: ScreenTermRow[], terms: RubricTerm[]): ScreenTermRow[] => {
    const byTerm = new Map<string, ScreenTermRow>();
    for (const r of rows) byTerm.set(canonical(r.term), r);
    const wanted = new Set(terms.map((t) => canonical(t.term)));
    report.termsDropped += rows.filter((r) => !wanted.has(canonical(r.term))).length;
    return terms.map((t) => {
      const row = byTerm.get(canonical(t.term));
      const floor = fromText(t);
      if (!row) {
        report.termsFilled++;
        return { term: t.term, level: floor.rung, quote: floor.quote, last_used: null };
      }
      let quote = located(row.quote);
      let level = row.level;
      if (rank(level) > rank('listed') && quote === null) {
        // Above "listed" the rung is the quote's; without one the text decides.
        level = floor.rung;
        quote = floor.quote;
        report.rungsLowered++;
      } else if (level !== 'absent' && floor.rung === 'absent' && quote === null) {
        level = 'absent';
        report.rungsLowered++;
      } else if (rank(level) < rank(floor.rung)) {
        // The text shows more than the model marked: a spelling the alias
        // table knows, or a work sentence it quoted the skills line over.
        level = floor.rung;
        quote = floor.quote ?? quote;
        report.rungsRaised++;
      }
      return { term: t.term, level, quote, last_used: inText(hay, row.last_used) ? row.last_used : null };
    });
  };

  const gates = rubric.gates.map((gate, i) => {
    const row = reply.gates.find((g) => canonical(g.gate) === canonical(gate)) ?? reply.gates[i];
    if (!row) return { gate, status: 'unknown' as const, quote: null, question: null };
    const quote = located(row.quote);
    if (row.status !== 'unknown' && quote === null) {
      report.gatesUnproven++;
      return { gate, status: 'unknown' as const, quote: null, question: row.question };
    }
    return { gate, status: row.status, quote, question: row.status === 'unknown' ? row.question : null };
  });

  const roles = reply.roles.filter((r) => {
    const ok =
      inText(hay, r.position) &&
      (r.start === null || inText(hay, r.start)) &&
      (r.end === null || inText(hay, r.end)) &&
      (r.employer === null || inText(hay, r.employer));
    if (!ok) report.rolesDropped++;
    return ok;
  });

  const impactQuotes = reply.impact.quotes.filter((q) => located(q) !== null);
  const impactGrade = reply.impact.grade === 'strong' && impactQuotes.length === 0 ? 'ok' : reply.impact.grade;

  return {
    reply: {
      ...reply,
      gates,
      must: anchorTerms(reply.must, rubric.must),
      nice: anchorTerms(reply.nice, rubric.nice),
      roles,
      level: { ...reply.level, signals: reply.level.signals.filter((s) => located(s) !== null) },
      impact: { grade: impactGrade, quotes: impactQuotes },
    },
    report,
  };
}

export function rank(rung: EvidenceRung): number {
  return EVIDENCE_RUNGS.indexOf(rung);
}

/**
 * What the text alone says about a term: absent, on a list of terms, or
 * inside a sentence — and that sentence, as the quote. "production" is the
 * model's call (ownership, outcome), never read off the text.
 */
export function textEvidence(
  term: Pick<RubricTerm, 'term' | 'aliases'>,
  text: string,
  matcher: Pick<KeywordMatcher, 'findTerm'>,
): { rung: EvidenceRung; quote: string | null } {
  const spans = matcher.findTerm(text, term.term, term.aliases);
  let listed: string | null = null;
  for (const span of spans) {
    const start = text.lastIndexOf('\n', span.start - 1) + 1;
    const end = text.indexOf('\n', span.start);
    const line = text.slice(start, end === -1 ? text.length : end).trim();
    if (!isTermList(line)) return { rung: 'role', quote: line.replace(/^[-•*]\s*/, '') };
    listed ??= line;
  }
  return listed === null ? { rung: 'absent', quote: null } : { rung: 'listed', quote: listed };
}
