import { z } from 'zod';
import { monthsSinceLatest, parseRange, yearsCovered, type DateRange } from './dates';
import { EVIDENCE_RUNGS, type EvidenceRung, type ScreenReply } from './prompts';
import { activeWeights, RUBRIC_PARTS, SCREEN_LEVELS, type Rubric, type RubricPart, type RubricTerm } from './rubric';

/*
 * The employer's score (ADR 0047): the model marks facts and quotes, this
 * module computes the number — score.ts's rule (ADR 0012) for the other side
 * of the table. Every part is traceable to a row of the scorecard, and the
 * three caps carry what weights cannot: no core stack, two levels under,
 * no impact evidence. Pure — tested in score.test.ts.
 *
 * "Unknown" is neither plus nor minus: a part the text cannot answer (no
 * dates, no level signal, no sector) leaves the denominator and lowers the
 * confidence instead. A short resume is not a weak one, it is an unread one.
 */

export const SCREEN_SCORING = {
  version: 1,
  /** The evidence ladder's credits (hr-screening-plan.md §4, blueprint §10). */
  rungCredit: { absent: 0, listed: 0.3, project: 0.5, role: 0.8, production: 1 } as Record<EvidenceRung, number>,
  impactCredit: { strong: 1, ok: 0.5, weak: 0 } as Record<ScreenReply['impact']['grade'], number>,
  domainCredit: { strong: 1, partial: 0.5, off: 0, unknown: 0 } as Record<ScreenReply['domain']['grade'], number>,
  educationCredit: { pass: 1, unknown: 0.5, fail: 0 } as Record<ScreenReply['education']['status'], number>,
  /** Years: the share of the minimum met, plus how recently the relevant work ended. */
  yearsShare: 0.7,
  recencyShare: 0.3,
  recency: [
    { months: 12, credit: 1 },
    { months: 36, credit: 0.7 },
    { months: 60, credit: 0.4 },
  ],
  recencyFloor: 0.2,
  /** Distance between the observed level and the posting's: same 1, one rung 0.5, further 0. */
  levelCredit: [1, 0.5, 0],
  caps: { primaryNone: 30, twoLevelsUnder: 50, impactWeak: 60 },
  /** Below this many characters the text is too thin to trust its silences. */
  thinChars: 900,
  confidence: { high: 0.75, medium: 0.45 },
  thinFactor: 0.6,
} as const;

export type GateBucket = 'pass' | 'ask' | 'fail';
export const GATE_BUCKETS: GateBucket[] = ['pass', 'ask', 'fail'];
export const GATE_BUCKET_LABELS: Record<GateBucket, string> = {
  pass: 'Priority to talk to',
  ask: 'Ask first',
  fail: 'Did not pass a gate',
};

export type ConfidenceBand = 'high' | 'medium' | 'low';
export type CapReason = 'primary' | 'level' | 'impact';

export interface PartScore {
  /** Points earned out of `max`; both 0 when the part does not apply. */
  pts: number;
  max: number;
  /** 0..1 credit, or null when the text could not answer. */
  credit: number | null;
  /** One line the scorecard shows under the part. */
  detail: string;
}

export interface ScreenBreakdown {
  v: number;
  score: number;
  cap: number | null;
  capReason: CapReason | null;
  parts: Record<RubricPart, PartScore>;
  /** Σ active weights — the denominator the parts were normalised over. */
  weightTotal: number;
  gateBucket: GateBucket;
  gatesFailed: string[];
  gatesUnknown: string[];
  mustCovered: number;
  mustTotal: number;
  primaryCovered: number;
  primaryTotal: number;
  years: number | null;
  recentMonths: number | null;
  confidence: { value: number; band: ConfidenceBand; answered: number; total: number; thin: boolean };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface ScreenScoreInput {
  rubric: Rubric;
  /** The anchored reply — anchor.ts has already lowered what the text does not show. */
  reply: ScreenReply;
  /** Length of the redacted text, for the thin-resume factor. */
  textChars: number;
  now: Date;
}

export function scoreScreening(input: ScreenScoreInput): ScreenBreakdown {
  const { rubric, reply, now } = input;
  const weights = activeWeights(rubric);
  const answered: boolean[] = [];

  // Gates — the bucket, never points.
  const gatesFailed = reply.gates.filter((g) => g.status === 'fail').map((g) => g.gate);
  const gatesUnknown = reply.gates.filter((g) => g.status === 'unknown').map((g) => g.gate);
  for (const g of reply.gates) answered.push(g.status !== 'unknown');
  const gateBucket: GateBucket = gatesFailed.length > 0 ? 'fail' : gatesUnknown.length > 0 ? 'ask' : 'pass';

  // Must-have and nice-to-have: Σ credit ÷ terms, either/or groups counted once.
  const must = termCredit(reply.must, rubric.must);
  const nice = termCredit(reply.nice, rubric.nice);
  for (const _ of rubric.must) answered.push(true);
  const primary = rubric.must.filter((t) => t.primary);
  const primaryCovered = primary.filter((t) => rungOf(reply.must, t) !== 'absent').length;

  // Years and recency from the relevant roles' dates.
  const ranges: DateRange[] = [];
  for (const r of reply.roles) {
    if (!r.relevant) continue;
    const range = parseRange(r.start, r.end, now);
    if (range) ranges.push(range);
  }
  const years = ranges.length > 0 ? yearsCovered(ranges) : null;
  const recentMonths = monthsSinceLatest(ranges, now);
  answered.push(years !== null);
  let yearsCredit: number | null = null;
  if (years !== null && recentMonths !== null) {
    const min = rubric.yearsMin;
    const share = min === null || min === 0 ? Math.min(1, years) : Math.min(1, years / min);
    const recency = SCREEN_SCORING.recency.find((r) => recentMonths <= r.months)?.credit ?? SCREEN_SCORING.recencyFloor;
    yearsCredit = SCREEN_SCORING.yearsShare * share + SCREEN_SCORING.recencyShare * recency;
  }

  // Level: distance between rungs, both directions.
  const wanted = rubric.level ? SCREEN_LEVELS.indexOf(rubric.level) : -1;
  const observed = reply.level.observed ? SCREEN_LEVELS.indexOf(reply.level.observed) : -1;
  if (rubric.level) answered.push(observed >= 0);
  let levelCredit: number | null = null;
  if (wanted >= 0 && observed >= 0) {
    const distance = Math.abs(observed - wanted);
    levelCredit = SCREEN_SCORING.levelCredit[Math.min(distance, 2)] ?? 0;
  }

  const impactCredit = SCREEN_SCORING.impactCredit[reply.impact.grade];
  answered.push(true);

  const domainKnown = rubric.domain !== null && reply.domain.grade !== 'unknown';
  if (rubric.domain) answered.push(domainKnown);
  const domainCredit = domainKnown ? SCREEN_SCORING.domainCredit[reply.domain.grade] : null;

  if (rubric.educationRequired) answered.push(reply.education.status !== 'unknown');
  const educationCredit = rubric.educationRequired ? SCREEN_SCORING.educationCredit[reply.education.status] : null;

  const credits: Record<RubricPart, number | null> = {
    must: rubric.must.length > 0 ? must.credit : null,
    years: yearsCredit,
    level: levelCredit,
    impact: impactCredit,
    domain: domainCredit,
    nice: rubric.nice.length > 0 ? nice.credit : null,
    education: educationCredit,
  };
  const details: Record<RubricPart, string> = {
    must: rubric.must.length === 0 ? 'no must-have terms in the rubric' : `${must.covered} of ${must.total} evidenced; ${must.strong} in a role or in production`,
    years:
      years === null
        ? 'no dated relevant role — ask'
        : `${years} relevant year${years === 1 ? '' : 's'}${rubric.yearsMin !== null ? ` of ${rubric.yearsMin} asked` : ''}, last ended ${describeMonths(recentMonths ?? 0)}`,
    level: !rubric.level
      ? 'the posting names no level'
      : observed < 0
        ? 'too little to say — ask'
        : `reads as ${reply.level.observed}, the posting hires ${rubric.level}`,
    impact: `${reply.impact.grade}: ${reply.impact.quotes.length} outcome line${reply.impact.quotes.length === 1 ? '' : 's'} quoted`,
    domain: !rubric.domain ? 'the posting names no sector' : domainKnown ? `${reply.domain.grade}: ${reply.domain.why}` : 'the text names no sector — ask',
    nice: rubric.nice.length === 0 ? 'no nice-to-have terms in the rubric' : `${nice.covered} of ${nice.total} evidenced`,
    education: !rubric.educationRequired ? 'not required by the posting' : `${reply.education.status}${reply.education.note ? `: ${reply.education.note}` : ''}`,
  };

  // Normalise over the parts that could answer: an unknown leaves the denominator.
  let weightTotal = 0;
  let earned = 0;
  const parts = {} as Record<RubricPart, PartScore>;
  for (const p of RUBRIC_PARTS) {
    const credit = credits[p];
    const max = credit === null ? 0 : weights[p];
    weightTotal += max;
    const pts = credit === null ? 0 : round1(max * credit);
    earned += pts;
    parts[p] = { pts, max, credit, detail: details[p] };
  }
  const raw = weightTotal === 0 ? 0 : Math.round((100 * earned) / weightTotal);

  // The caps, strictest first when several apply.
  let cap: number | null = null;
  let capReason: CapReason | null = null;
  const apply = (value: number, reason: CapReason) => {
    if (cap === null || value < cap) {
      cap = value;
      capReason = reason;
    }
  };
  if (primary.length > 0 && primaryCovered === 0) apply(SCREEN_SCORING.caps.primaryNone, 'primary');
  if (wanted >= 0 && observed >= 0 && wanted - observed >= 2) apply(SCREEN_SCORING.caps.twoLevelsUnder, 'level');
  if (reply.impact.grade === 'weak' && ranges.length > 0) apply(SCREEN_SCORING.caps.impactWeak, 'impact');
  const score = Math.max(0, Math.min(100, cap === null ? raw : Math.min(raw, cap)));

  const thin = input.textChars < SCREEN_SCORING.thinChars;
  const answeredCount = answered.filter(Boolean).length;
  const value = round1((answered.length === 0 ? 1 : answeredCount / answered.length) * (thin ? SCREEN_SCORING.thinFactor : 1) * 100) / 100;
  const band: ConfidenceBand = value >= SCREEN_SCORING.confidence.high ? 'high' : value >= SCREEN_SCORING.confidence.medium ? 'medium' : 'low';

  return {
    v: SCREEN_SCORING.version,
    score,
    cap,
    capReason,
    parts,
    weightTotal,
    gateBucket,
    gatesFailed,
    gatesUnknown,
    mustCovered: must.covered,
    mustTotal: must.total,
    primaryCovered,
    primaryTotal: primary.length,
    years,
    recentMonths,
    confidence: { value, band, answered: answeredCount, total: answered.length, thin },
  };
}

function rungOf(rows: ScreenReply['must'], term: RubricTerm): EvidenceRung {
  return rows.find((r) => r.term.trim().toLowerCase() === term.term.trim().toLowerCase())?.level ?? 'absent';
}

/** Σ credit over the rubric's terms, an either/or group taking its best member once (ADR 0044). */
function termCredit(rows: ScreenReply['must'], terms: RubricTerm[]): { credit: number; covered: number; total: number; strong: number } {
  const best = new Map<string, number>();
  let covered = 0;
  let strong = 0;
  for (const t of terms) {
    const rung = rungOf(rows, t);
    const key = t.group ? `group:${t.group.toLowerCase()}` : `term:${t.term.toLowerCase()}`;
    best.set(key, Math.max(best.get(key) ?? 0, SCREEN_SCORING.rungCredit[rung]));
    if (rung !== 'absent') covered++;
    if (EVIDENCE_RUNGS.indexOf(rung) >= EVIDENCE_RUNGS.indexOf('role')) strong++;
  }
  const total = best.size;
  let sum = 0;
  for (const v of best.values()) sum += v;
  return { credit: total === 0 ? 0 : sum / total, covered, total: terms.length, strong };
}

function describeMonths(months: number): string {
  if (months <= 1) return 'this month';
  if (months < 24) return `${months} months ago`;
  return `${Math.round(months / 12)} years ago`;
}

/** Plain-words reason for the cap — the table must never show a number it cannot explain. */
export function capExplanation(bd: ScreenBreakdown): string | null {
  switch (bd.capReason) {
    case 'primary':
      return `Capped at ${bd.cap}: none of the ${bd.primaryTotal} core-stack terms is anywhere in the resume.`;
    case 'level':
      return `Capped at ${bd.cap}: the text reads two levels below the level the posting hires at.`;
    case 'impact':
      return `Capped at ${bd.cap}: the relevant roles list duties and technologies, never an outcome.`;
    default:
      return null;
  }
}

/** Bucket first, score inside it, confidence on ties, then the applicant number — the table's order. */
export function orderVerdicts<T extends { gateBucket: GateBucket; score: number; confidence: ConfidenceBand; number: number }>(rows: T[]): T[] {
  const bucketRank: Record<GateBucket, number> = { pass: 0, ask: 1, fail: 2 };
  const bandRank: Record<ConfidenceBand, number> = { high: 0, medium: 1, low: 2 };
  return [...rows].sort(
    (a, b) =>
      bucketRank[a.gateBucket] - bucketRank[b.gateBucket] ||
      b.score - a.score ||
      bandRank[a.confidence] - bandRank[b.confidence] ||
      a.number - b.number,
  );
}

/* Stored JSON: the computation plus the prompt that produced the facts. */

const PartSchema = z.object({ pts: z.number(), max: z.number(), credit: z.number().nullable(), detail: z.string().default('') });

const BreakdownSchema = z.object({
  v: z.number().int(),
  score: z.number(),
  cap: z.number().nullable(),
  capReason: z.enum(['primary', 'level', 'impact']).nullish().transform((x) => x ?? null),
  parts: z.object(Object.fromEntries(RUBRIC_PARTS.map((p) => [p, PartSchema])) as Record<RubricPart, typeof PartSchema>),
  weightTotal: z.number(),
  gateBucket: z.enum(['pass', 'ask', 'fail']),
  gatesFailed: z.array(z.string()).default([]),
  gatesUnknown: z.array(z.string()).default([]),
  mustCovered: z.number().int(),
  mustTotal: z.number().int(),
  primaryCovered: z.number().int(),
  primaryTotal: z.number().int(),
  years: z.number().nullable(),
  recentMonths: z.number().nullable(),
  confidence: z.object({
    value: z.number(),
    band: z.enum(['high', 'medium', 'low']),
    answered: z.number().int(),
    total: z.number().int(),
    thin: z.boolean().default(false),
  }),
});

export function readScreenBreakdown(value: unknown): ScreenBreakdown | null {
  const r = BreakdownSchema.safeParse(value);
  return r.success ? r.data : null;
}
