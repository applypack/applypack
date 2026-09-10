import { z } from 'zod';
import { normaliseForAnchor } from '../resume/structure-anchor';
import type { KeywordMatcher } from '../resume/keyword-matcher';
import { inText } from './anchor';
import { CompareReplySchema, type CompareReply } from './prompts';
import type { Criterion, Rubric } from './rubric';

/*
 * Compare with AI, the pure half (plan §5.1, ADR 0051): the two readings of
 * a shortlist as they are stored, the anchor that keeps a quote only in the
 * resume it came from, the view that puts the readings side by side and
 * says where they differ, and the Markdown the Copy button hands over.
 * Nothing here is a score, and nothing here writes one: the table's order
 * stays the criteria's; the comparison is the argument for the shortlist
 * meeting.
 */

const ReadingSchema = z.object({
  /** The applicant numbers in the order the resumes were shown. */
  shown: z.array(z.number().int()),
  reply: CompareReplySchema,
});
export type Reading = z.infer<typeof ReadingSchema>;

const StoredComparisonSchema = z.object({ v: z.literal(1), readings: z.tuple([ReadingSchema, ReadingSchema]) });
export type StoredComparison = z.infer<typeof StoredComparisonSchema>;

export function readStoredComparison(value: unknown): StoredComparison | null {
  const parsed = StoredComparisonSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The second reading's order: reversed, so the first and last slots — where listwise position bias lives — swap. */
export function secondOrder<T>(items: T[]): T[] {
  return [...items].reverse();
}

export interface CompareAnchorReport {
  /** Quotes not found in the resume they were attributed to. */
  quotesDropped: number;
  /** Applicant numbers the shortlist does not hold, or named twice. */
  numbersDropped: number;
  /** Entries for a criterion the rubric does not have, or a second entry for one. */
  criteriaDropped: number;
}

/** Every quote must be in THAT applicant's redacted text; every number must be on the shortlist, once. */
export function anchorCompareReply(
  reply: CompareReply,
  texts: Map<number, string>,
  rubric: Rubric,
  matcher: Pick<KeywordMatcher, 'locateQuote'>,
): { reply: CompareReply; report: CompareAnchorReport } {
  const report: CompareAnchorReport = { quotesDropped: 0, numbersDropped: 0, criteriaDropped: 0 };
  const hays = new Map([...texts].map(([n, t]) => [n, normaliseForAnchor(t)] as const));
  const placed = (numbers: number[]): number[] => {
    const out: number[] = [];
    for (const n of numbers) {
      if (!texts.has(n) || out.includes(n)) {
        report.numbersDropped++;
        continue;
      }
      out.push(n);
    }
    return out;
  };
  const wanted = new Set(rubric.criteria.map((c) => c.id));
  const seen = new Set<string>();
  const criteria = reply.criteria
    .filter((c) => {
      const ok = wanted.has(c.id) && !seen.has(c.id);
      if (!ok) report.criteriaDropped++;
      seen.add(c.id);
      return ok;
    })
    .map((c) => ({
      ...c,
      ranking: placed(c.ranking),
      quotes: c.quotes.filter((q) => {
        const text = texts.get(q.applicant);
        const ok = text !== undefined && (matcher.locateQuote(text, q.quote) !== null || inText(hays.get(q.applicant)!, q.quote));
        if (!ok) report.quotesDropped++;
        return ok;
      }),
    }));
  const order = placed(reply.order.map((o) => o.applicant)).map((n) => reply.order.find((o) => o.applicant === n)!);
  return { reply: { ...reply, criteria, order }, report };
}

export interface CriterionComparison {
  id: string;
  label: string;
  kind: Criterion['kind'];
  mode: Criterion['mode'];
  /** Strongest first, per reading. */
  rankings: [number[], number[]];
  picks: [number | null, number | null];
  /** Both readings placed the same applicant first. */
  agree: boolean;
  why: [string, string];
  /** One quote per applicant, the first reading's first. */
  quotes: { applicant: number; quote: string }[];
}

export interface OverallPlace {
  applicant: number;
  reason: string;
}

export interface ComparisonView {
  /** The shortlist in the table's order — the first reading's. */
  applicants: number[];
  shown: [number[], number[]];
  criteria: CriterionComparison[];
  orders: [OverallPlace[], OverallPlace[]];
  firstAgree: boolean;
  orderAgree: boolean;
  deciders: [string | null, string | null];
  /** Criteria on which both readings placed someone first and disagreed. */
  disagreements: number;
  injection: boolean;
}

/** The two readings against the CURRENT rubric — a criterion added since reads as unanswered, one removed is not shown. */
export function comparisonView(stored: StoredComparison, rubric: Rubric): ComparisonView {
  const [a, b] = stored.readings;
  const A = new Map(a.reply.criteria.map((c) => [c.id, c]));
  const B = new Map(b.reply.criteria.map((c) => [c.id, c]));
  const criteria = rubric.criteria.map((c): CriterionComparison => {
    const x = A.get(c.id);
    const y = B.get(c.id);
    const picks: [number | null, number | null] = [x?.ranking[0] ?? null, y?.ranking[0] ?? null];
    const quotes: { applicant: number; quote: string }[] = [];
    for (const q of [...(x?.quotes ?? []), ...(y?.quotes ?? [])]) if (!quotes.some((k) => k.applicant === q.applicant)) quotes.push(q);
    return {
      id: c.id,
      label: c.label,
      kind: c.kind,
      mode: c.mode,
      rankings: [x?.ranking ?? [], y?.ranking ?? []],
      picks,
      agree: picks[0] !== null && picks[0] === picks[1],
      why: [x?.why ?? '', y?.why ?? ''],
      quotes,
    };
  });
  const orders: [OverallPlace[], OverallPlace[]] = [a.reply.order, b.reply.order];
  const first = [orders[0][0]?.applicant ?? null, orders[1][0]?.applicant ?? null];
  return {
    applicants: a.shown,
    shown: [a.shown, b.shown],
    criteria,
    orders,
    firstAgree: first[0] !== null && first[0] === first[1],
    orderAgree: orders[0].length === orders[1].length && orders[0].every((o, i) => o.applicant === orders[1][i]!.applicant),
    deciders: [a.reply.decider, b.reply.decider],
    disagreements: criteria.filter((c) => c.picks[0] !== null && c.picks[1] !== null && !c.agree).length,
    injection: a.reply.injection || b.reply.injection,
  };
}

/** "№3 Hanna Schmidt" — the number always, the name when the person has one. */
export function who(n: number, names: Map<number, string | null>): string {
  const name = names.get(n);
  return name ? `№${n} ${name}` : `№${n}`;
}

const arrow = (ranking: number[]): string => (ranking.length === 0 ? '—' : ranking.map((n) => `№${n}`).join(' › '));

/** The comparison as Markdown — what "Copy" puts on the clipboard for the shortlist meeting. */
export function comparisonMarkdown(view: ComparisonView, names: Map<number, string | null>, title: string): string {
  const out: string[] = [
    `# Shortlist — ${title}`,
    '',
    `Applicants: ${view.applicants.map((n) => who(n, names)).join(', ')}. Two readings by the model, the second with the resumes in the reverse order; where they differ, that is information. Names were never seen by the model.`,
    '',
    '## Order to talk to',
    '',
  ];
  view.orders.forEach((order, i) => {
    out.push(`Reading ${i === 0 ? 'A' : 'B'}:`);
    order.forEach((o, j) => out.push(`${j + 1}. ${who(o.applicant, names)} — ${o.reason}`));
    out.push('');
  });
  out.push(view.orderAgree ? 'The two readings agree on the order.' : view.firstAgree ? 'The two readings agree on who is first and differ below.' : 'The two readings differ on who is first.', '');
  const deciders = view.deciders.filter((d): d is string => d !== null);
  if (deciders.length > 0) out.push(`What would decide between the first two: ${deciders.join(' / ')}`, '');
  out.push('## By criterion', '', '| Criterion | Reading A | Reading B | |', '|---|---|---|---|');
  for (const c of view.criteria) {
    const mark = c.picks[0] === null || c.picks[1] === null ? '' : c.agree ? 'agree' : 'differ';
    out.push(`| ${c.label.replace(/\|/g, '\\|')} | ${arrow(c.rankings[0])} | ${arrow(c.rankings[1])} | ${mark} |`);
  }
  out.push('');
  for (const c of view.criteria) {
    if (!c.why[0] && !c.why[1] && c.quotes.length === 0) continue;
    out.push(`**${c.label}.** ${[c.why[0], c.why[1]].filter(Boolean).join(' / ')}`);
    for (const q of c.quotes) out.push(`- ${who(q.applicant, names)}: "${q.quote}"`);
    out.push('');
  }
  return out.join('\n');
}
