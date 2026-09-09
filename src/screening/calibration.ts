import type { GateStatus } from './prompts';
import type { Criterion, Rubric } from './rubric';
import type { GateBucket } from './score';

/*
 * Calibration (plan §6 stage E, ADR 0052): the person's own decisions held
 * against the table's order, per screening. The tool never writes a
 * decision (ADR 0047), so the decisions are the one signal about whether
 * the criteria rank the way the person does — and this module reads that
 * signal without ever touching the rubric. Pure: tested in
 * calibration.test.ts.
 *
 * Three readings, all honest with small numbers:
 * - pairs: every pair of applicants the person decided differently
 *   (interview above hold above declined) — does the table order them the
 *   same way? Concordant / discordant, as Kendall's τ counts them;
 * - the top: of k applicants marked "To interview", how many sit in the
 *   table's top k;
 * - the surprises: an interview pick the table put low, a declined
 *   applicant the table put high — with the criteria that made the
 *   difference, so the person can see whether a criterion or a weight is
 *   wrong, and change it themselves.
 * Plus, per scored criterion, how far apart the interviewed and the
 * declined sit on it — the criteria that separate the person's picks from
 * the rest, and the ones that do not.
 */

export type Decided = 'interview' | 'hold' | 'declined';
const DECISION_RANK: Record<Decided, number> = { interview: 2, hold: 1, declined: 0 };

/** At least this many decisions, with both an interview and a declined among them, before the card says anything. */
export const MIN_DECISIONS = 3;
/** Surprises and separations name this many criteria at most. */
const WHY_LIMIT = 3;

export interface CalibrationRow {
  number: number;
  /** 1-based place in the table's order (bucket → adjusted score → confidence). */
  position: number;
  /** The same place when the person's adjustments are ignored. */
  computedPosition: number;
  decision: Decided | null;
  score: number;
  adjusted: number;
  bucket: GateBucket;
  /** Per scored criterion id: the credit 0..1, or null when the text could not answer. */
  credits: Record<string, number | null>;
  /** Per criterion id: the answer in a word, as the scorecard shows it. */
  answers: Record<string, string>;
  /** Per gate criterion id. */
  gates: Record<string, GateStatus>;
}

export interface Pairs {
  concordant: number;
  discordant: number;
  /** Discordant under the computed score that the person's adjustments turned concordant. */
  fixedByAdjustment: number;
}

export interface Surprise {
  number: number;
  position: number;
  total: number;
  decision: 'interview' | 'declined';
  /** The criteria behind the table's placing, as short phrases. */
  why: string[];
}

export interface Separation {
  id: string;
  label: string;
  weight: number;
  /** Mean credit among the interviewed, and among the declined; null with nothing to average. */
  interviewed: number | null;
  declined: number | null;
  /** interviewed − declined; null when one side is empty. */
  gap: number | null;
}

export interface Calibration {
  total: number;
  decided: Record<Decided, number>;
  enough: boolean;
  pairs: Pairs;
  /** concordant / (concordant + discordant), null with no pairs. */
  agreement: number | null;
  top: { k: number; hit: number } | null;
  surprises: Surprise[];
  /** Scored criteria, the widest gap first. */
  separations: Separation[];
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100);

export function calibrate(rows: CalibrationRow[], rubric: Rubric): Calibration {
  const decided: Record<Decided, number> = { interview: 0, hold: 0, declined: 0 };
  const withDecision = rows.filter((r): r is CalibrationRow & { decision: Decided } => r.decision !== null);
  for (const r of withDecision) decided[r.decision]++;
  const enough = withDecision.length >= MIN_DECISIONS && decided.interview > 0 && decided.declined > 0;

  const pairs: Pairs = { concordant: 0, discordant: 0, fixedByAdjustment: 0 };
  for (let i = 0; i < withDecision.length; i++) {
    for (let j = 0; j < withDecision.length; j++) {
      const a = withDecision[i]!;
      const b = withDecision[j]!;
      if (DECISION_RANK[a.decision] <= DECISION_RANK[b.decision]) continue;
      // a is the one the person rates higher: the table agrees when a sits above b.
      if (a.position < b.position) pairs.concordant++;
      else pairs.discordant++;
      if (a.computedPosition > b.computedPosition && a.position < b.position) pairs.fixedByAdjustment++;
    }
  }
  const agreement = pairs.concordant + pairs.discordant === 0 ? null : Math.round((pairs.concordant / (pairs.concordant + pairs.discordant)) * 100) / 100;

  const k = decided.interview;
  const top = k === 0 ? null : { k, hit: withDecision.filter((r) => r.decision === 'interview' && r.position <= k).length };

  const scored = rubric.criteria.filter((c) => c.mode === 'scored');
  const gates = rubric.criteria.filter((c) => c.mode === 'gate');
  const surprises: Surprise[] = [];
  for (const r of withDecision) {
    if (r.decision === 'interview' && k > 0 && r.position > k) surprises.push({ number: r.number, position: r.position, total: rows.length, decision: 'interview', why: whyLow(r, scored, gates) });
    if (r.decision === 'declined' && k > 0 && r.position <= k) surprises.push({ number: r.number, position: r.position, total: rows.length, decision: 'declined', why: whyHigh(r, scored) });
  }
  surprises.sort((a, b) => a.position - b.position);

  const separations = scored
    .map((c): Separation => {
      const interviewed = mean(withDecision.filter((r) => r.decision === 'interview').map((r) => r.credits[c.id]).filter((v): v is number => v !== null && v !== undefined));
      const declined = mean(withDecision.filter((r) => r.decision === 'declined').map((r) => r.credits[c.id]).filter((v): v is number => v !== null && v !== undefined));
      return { id: c.id, label: c.label, weight: c.weight, interviewed, declined, gap: interviewed === null || declined === null ? null : Math.round((interviewed - declined) * 100) / 100 };
    })
    .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0) || b.weight - a.weight);

  return { total: rows.length, decided, enough, pairs, agreement, top, surprises, separations };
}

/** What held an interview pick down: a gate not passed, then the heaviest criteria with the least credit. */
function whyLow(r: CalibrationRow, scored: Criterion[], gates: Criterion[]): string[] {
  const out: string[] = [];
  for (const g of gates) {
    const status = r.gates[g.id];
    if (status === 'fail') out.push(`${g.label}: failed`);
    else if (status === 'unknown') out.push(`${g.label}: unknown`);
  }
  // The heaviest criterion with the most credit missing first: stars × (1 − credit).
  const weak = scored
    .map((c) => ({ c, credit: r.credits[c.id] ?? null }))
    .filter((x) => x.credit !== null && x.credit < 0.5)
    .sort((a, b) => b.c.weight * (1 - b.credit!) - a.c.weight * (1 - a.credit!) || b.c.weight - a.c.weight);
  for (const x of weak) out.push(`${x.c.label}: ${r.answers[x.c.id] ?? 'low'}`);
  return out.slice(0, WHY_LIMIT);
}

/** What lifted a declined applicant: the heaviest criteria with the most credit. */
function whyHigh(r: CalibrationRow, scored: Criterion[]): string[] {
  return scored
    .map((c) => ({ c, credit: r.credits[c.id] ?? null }))
    .filter((x) => x.credit !== null && x.credit >= 0.8)
    .sort((a, b) => b.c.weight * b.credit! - a.c.weight * a.credit! || b.c.weight - a.c.weight)
    .slice(0, WHY_LIMIT)
    .map((x) => `${x.c.label}: ${r.answers[x.c.id] ?? 'strong'}`);
}

/** One sentence for the card's head and the export. */
export function calibrationLine(c: Calibration): string {
  if (!c.enough) {
    const n = c.decided.interview + c.decided.hold + c.decided.declined;
    return n === 0
      ? `Decide on at least ${MIN_DECISIONS} applicants — one To interview and one Declined among them — and this card says whether the criteria rank the way you do.`
      : `${n} decision${n === 1 ? '' : 's'} so far; at least ${MIN_DECISIONS}, with one To interview and one Declined among them, before the table can be held against them.`;
  }
  const parts: string[] = [];
  if (c.top) parts.push(`${c.top.hit} of your ${c.top.k} To interview sit in the table's top ${c.top.k}`);
  if (c.agreement !== null) parts.push(`the table orders ${Math.round(c.agreement * 100)}% of your pairs the way you decided (${c.pairs.concordant} of ${c.pairs.concordant + c.pairs.discordant})`);
  if (c.pairs.fixedByAdjustment > 0) parts.push(`${c.pairs.fixedByAdjustment} of those only after your adjustments`);
  return `${parts.join('; ')}.`;
}
