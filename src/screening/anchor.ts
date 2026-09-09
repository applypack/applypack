import { normaliseForAnchor } from '../resume/structure-anchor';
import { evidenceFor } from '../resume/evidence';
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
 *   to what evidence.ts reads off the text (a skills line → listed, a work
 *   sentence → role), and a term the matcher cannot find at all is absent;
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
  const report: AnchorReport = { quotesDropped: 0, rungsLowered: 0, termsFilled: 0, termsDropped: 0, gatesUnproven: 0, rolesDropped: 0 };
  const hay = normaliseForAnchor(text);

  const located = (quote: string | null): string | null => {
    if (quote === null) return null;
    if (matcher.locateQuote(text, quote) !== null || inText(hay, quote)) return quote;
    report.quotesDropped++;
    return null;
  };
  const rungFromText = (t: RubricTerm): EvidenceRung => {
    const evidence = evidenceFor({ term: t.term, aliases: t.aliases }, text, matcher);
    return evidence === 'absent' ? 'absent' : evidence === 'listed' ? 'listed' : 'role';
  };
  const anchorTerms = (rows: ScreenTermRow[], terms: RubricTerm[]): ScreenTermRow[] => {
    const byTerm = new Map<string, ScreenTermRow>();
    for (const r of rows) byTerm.set(canonical(r.term), r);
    const wanted = new Set(terms.map((t) => canonical(t.term)));
    report.termsDropped += rows.filter((r) => !wanted.has(canonical(r.term))).length;
    return terms.map((t) => {
      const row = byTerm.get(canonical(t.term));
      const floor = rungFromText(t);
      if (!row) {
        report.termsFilled++;
        return { term: t.term, level: floor, quote: null, last_used: null };
      }
      const quote = located(row.quote);
      let level = row.level;
      // Above "listed" the rung is the quote's; below it the text decides.
      if (rank(level) > rank('listed') && quote === null) {
        level = floor;
        report.rungsLowered++;
      } else if (level !== 'absent' && floor === 'absent' && quote === null) {
        level = 'absent';
        report.rungsLowered++;
      } else if (level === 'absent' && floor !== 'absent') {
        // The model missed a spelling the alias table knows.
        level = floor;
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
