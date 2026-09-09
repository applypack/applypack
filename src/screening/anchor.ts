import { normaliseForAnchor } from '../resume/structure-anchor';
import { isTermList } from '../resume/evidence';
import type { KeywordMatcher } from '../resume/keyword-matcher';
import { EVIDENCE_RUNGS, type Criterion, type EvidenceRung, type Rubric } from './rubric';
import { answerShape, type ScreenAnswer, type ScreenReply } from './prompts';

/*
 * The persist-time guard for a screening reply (ADR 0047 / 0050): every
 * quote the model gave is checked against the redacted text, and an answer
 * the text cannot show is lowered to what the text can. The same principle
 * as keyword-anchor.ts and structure-anchor.ts on the candidate side — the
 * text outranks the model — applied where it matters most: a score a person
 * will act on has to be readable off the resume it came from.
 *
 * Rules, per answer shape:
 * - rung (a skill, a "how much" question): a rung above "listed" needs a
 *   located quote, else it falls to what the text shows (a skills line →
 *   listed, a work sentence → role); a term the matcher finds in a work
 *   sentence is at least "role" whatever the model marked; a term the
 *   matcher cannot find at all is absent;
 * - status (a gate-shaped question): pass, partial and fail need a located
 *   quote, else unknown — a mark with no quote is a claim the person cannot
 *   check;
 * - level, impact, overall: the quote is located or dropped; an impact
 *   "strong" with no quote becomes "ok";
 * - a role whose position or dates the text does not carry is dropped, and
 *   so is a stand-out fact whose quote is not in the text;
 * - the RUBRIC is the frame: a criterion the model skipped gets an answer
 *   from the text alone (a skill) or "unknown" (anything else), an answer
 *   for an id the rubric never named is dropped.
 *
 * Pure: text, reply, rubric and the matcher in; reply and a report out.
 */

export interface AnchorReport {
  quotesDropped: number;
  rungsLowered: number;
  rungsRaised: number;
  answersFilled: number;
  answersDropped: number;
  statusesUnproven: number;
  rolesDropped: number;
  /** Stand-out facts whose quote the text does not carry. */
  standoutDropped: number;
}

type Matcher = Pick<KeywordMatcher, 'findTerm' | 'locateQuote'>;

/** A verbatim span of the text, after the anchor normalisation, or not. */
export function inText(haystack: string, value: string | null | undefined): boolean {
  if (!value) return false;
  const needle = normaliseForAnchor(value);
  return needle.length > 0 && haystack.includes(needle);
}

export function rank(rung: EvidenceRung): number {
  return EVIDENCE_RUNGS.indexOf(rung);
}

/**
 * What the text alone says about a term (or any of its alternatives):
 * absent, on a list of terms, or inside a sentence — and that sentence, as
 * the quote. "production" is the model's call (ownership, outcome), never
 * read off the text.
 */
export function textEvidence(
  terms: { term: string; aliases: string[] }[],
  text: string,
  matcher: Pick<KeywordMatcher, 'findTerm'>,
): { rung: EvidenceRung; quote: string | null } {
  let listed: string | null = null;
  for (const t of terms) {
    for (const span of matcher.findTerm(text, t.term, t.aliases)) {
      const start = text.lastIndexOf('\n', span.start - 1) + 1;
      const end = text.indexOf('\n', span.start);
      const line = text.slice(start, end === -1 ? text.length : end).trim();
      if (!isTermList(line)) return { rung: 'role', quote: line.replace(/^[-•*]\s*/, '') };
      listed ??= line;
    }
  }
  return listed === null ? { rung: 'absent', quote: null } : { rung: 'listed', quote: listed };
}

const blank = (id: string): ScreenAnswer => ({
  id,
  status: null,
  rung: null,
  level: null,
  impact: null,
  overall: null,
  quote: null,
  note: null,
  question: null,
  last_used: null,
  reasons: [],
  concerns: [],
});

export function anchorScreenReply(reply: ScreenReply, text: string, rubric: Rubric, matcher: Matcher): { reply: ScreenReply; report: AnchorReport } {
  const report: AnchorReport = { quotesDropped: 0, rungsLowered: 0, rungsRaised: 0, answersFilled: 0, answersDropped: 0, statusesUnproven: 0, rolesDropped: 0, standoutDropped: 0 };
  const hay = normaliseForAnchor(text);
  const located = (quote: string | null): string | null => {
    if (quote === null) return null;
    if (matcher.locateQuote(text, quote) !== null || inText(hay, quote)) return quote;
    report.quotesDropped++;
    return null;
  };
  const byId = new Map(reply.answers.map((a) => [a.id, a]));
  const wanted = new Set(rubric.criteria.map((c) => c.id));
  report.answersDropped = reply.answers.filter((a) => !wanted.has(a.id)).length;

  const answers: ScreenAnswer[] = [];
  for (const c of rubric.criteria) {
    const shape = answerShape(c);
    if (shape === 'roles') continue;
    const given = byId.get(c.id);
    if (!given) report.answersFilled++;
    answers.push(anchorAnswer(c, shape, given ?? blank(c.id), text, hay, matcher, located, report));
  }

  const roles = reply.roles.filter((r) => {
    const ok =
      inText(hay, r.position) &&
      (r.start === null || inText(hay, r.start)) &&
      (r.end === null || inText(hay, r.end)) &&
      (r.employer === null || inText(hay, r.employer));
    if (!ok) report.rolesDropped++;
    return ok;
  });

  // A stand-out fact is only as good as its line: no located quote, no fact (it was never scored, so nothing else moves).
  const standout = reply.standout.filter((f) => {
    const ok = f.quote !== null && (matcher.locateQuote(text, f.quote) !== null || inText(hay, f.quote));
    if (!ok) report.standoutDropped++;
    return ok;
  });

  return { reply: { ...reply, answers, roles, standout }, report };
}

function anchorAnswer(
  c: Criterion,
  shape: string,
  a: ScreenAnswer,
  text: string,
  hay: string,
  matcher: Matcher,
  located: (q: string | null) => string | null,
  report: AnchorReport,
): ScreenAnswer {
  const quote = located(a.quote);
  switch (shape) {
    case 'rung': {
      const terms = c.kind === 'skill' ? c.spec.terms : [];
      const floor = terms.length > 0 ? textEvidence(terms, text, matcher) : null;
      if (a.rung === null) {
        // The model skipped it: the text alone answers, and that is not a lowering.
        return { ...a, rung: floor?.rung ?? 'absent', quote: floor?.quote ?? null, last_used: null, status: null };
      }
      let rung: EvidenceRung = a.rung;
      let q = quote;
      if (floor) {
        if (rank(rung) > rank('listed') && q === null) {
          rung = floor.rung;
          q = floor.quote;
          report.rungsLowered++;
        } else if (rung !== 'absent' && floor.rung === 'absent' && q === null) {
          rung = 'absent';
          report.rungsLowered++;
        } else if (rank(rung) < rank(floor.rung)) {
          rung = floor.rung;
          q = floor.quote ?? q;
          report.rungsRaised++;
        }
      } else if (rank(rung) > rank('listed') && q === null) {
        // A "how much" question in the person's words: no term to search for, so an unquoted rung is at most "listed".
        rung = 'listed';
        report.rungsLowered++;
      }
      return { ...a, rung, quote: q, last_used: inText(hay, a.last_used) ? a.last_used : null, status: null };
    }
    case 'status': {
      const status = a.status ?? 'unknown';
      if (status !== 'unknown' && quote === null) {
        report.statusesUnproven++;
        return { ...a, status: 'unknown', quote: null, rung: null };
      }
      return { ...a, status, quote, question: status === 'unknown' ? a.question : null, rung: null };
    }
    case 'level':
      return { ...a, quote };
    case 'impact': {
      const impact = a.impact === 'strong' && quote === null ? 'ok' : (a.impact ?? 'weak');
      return { ...a, impact, quote };
    }
    case 'overall':
      return { ...a, overall: a.overall ?? 'partial', quote };
    default:
      return { ...a, quote };
  }
}
