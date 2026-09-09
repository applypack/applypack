import { z } from 'zod';
import { monthsSinceLatest, parseRange, parseResumeDate, yearsCovered, type DateRange } from './dates';
import { answerShape, type ImpactGrade, type OverallGrade, type ScreenAnswer, type ScreenReply, type ScreenRole } from './prompts';
import { coreCriteria, CRITERION_MODES, EVIDENCE_RUNGS, SCREEN_LEVELS, type Criterion, type EvidenceRung, type Rubric } from './rubric';

/*
 * The employer's score, version 2 (ADR 0050 over ADR 0047): the model
 * answers the criteria and this module turns the answers into the number
 * with the person's weights. Every point is a criterion's — one row of the
 * scorecard: what was asked, what the text answered, the quote, the points.
 * Three caps carry what stars cannot: no core-stack term anywhere, two
 * levels under, duties only. Pure — tested in score.test.ts.
 *
 * "Unknown" is neither plus nor minus: a criterion the text cannot answer
 * leaves the denominator and lowers the confidence instead. A short resume
 * is not a weak one, it is an unread one.
 */

export const SCREEN_SCORING = {
  version: 2,
  rungCredit: { absent: 0, listed: 0.3, project: 0.5, role: 0.8, production: 1 } as Record<EvidenceRung, number>,
  statusCredit: { pass: 1, partial: 0.5, fail: 0 } as Record<'pass' | 'partial' | 'fail', number>,
  impactCredit: { strong: 1, ok: 0.5, weak: 0 } as Record<ImpactGrade, number>,
  overallCredit: { exceptional: 1, strong: 0.75, partial: 0.5, weak: 0.25, none: 0 } as Record<OverallGrade, number>,
  /** Years: the share of the band met, plus how recently the relevant work ended. */
  yearsShare: 0.7,
  recencyShare: 0.3,
  recency: [
    { months: 12, credit: 1 },
    { months: 36, credit: 0.7 },
    { months: 60, credit: 0.4 },
  ],
  recencyFloor: 0.2,
  /** A skill last used longer ago than the criterion's window earns half. */
  staleFactor: 0.5,
  caps: { coreNone: 30, twoLevelsUnder: 50, impactWeak: 60 },
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
export type CapReason = 'core' | 'level' | 'impact';

/** One criterion, answered and weighed — a row of the scorecard. */
export interface ScoreRow {
  id: string;
  kind: Criterion['kind'];
  label: string;
  mode: Criterion['mode'];
  weight: number;
  /** 0..1, or null when the text could not answer (leaves the denominator). */
  credit: number | null;
  pts: number;
  max: number;
  /** For a gate: pass / unknown / fail. */
  gate: 'pass' | 'unknown' | 'fail' | null;
  /** The answer in a word or two — "role", "pass", "senior", "strong", "9.8 years". */
  answer: string;
  quote: string | null;
  detail: string;
  question: string | null;
}

export interface ScreenBreakdown {
  v: number;
  score: number;
  cap: number | null;
  capReason: CapReason | null;
  rows: ScoreRow[];
  weightTotal: number;
  gateBucket: GateBucket;
  gatesFailed: string[];
  gatesUnknown: string[];
  /** Skill criteria evidenced at all / in a role or in production / total. */
  skillsCovered: number;
  skillsStrong: number;
  skillsTotal: number;
  coreCovered: number;
  coreTotal: number;
  years: number | null;
  recentMonths: number | null;
  level: string | null;
  confidence: { value: number; band: ConfidenceBand; answered: number; total: number; thin: boolean };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const rank = (r: EvidenceRung): number => EVIDENCE_RUNGS.indexOf(r);

export interface ScreenScoreInput {
  rubric: Rubric;
  /** The anchored reply — anchor.ts has already lowered what the text does not show. */
  reply: ScreenReply;
  textChars: number;
  now: Date;
}

interface RoleFacts {
  ranges: DateRange[];
  years: number | null;
  recentMonths: number | null;
  /** Dated roles, relevant or not, with their sector and type. */
  dated: { range: DateRange; role: ScreenRole }[];
}

function roleFacts(reply: ScreenReply, now: Date): RoleFacts {
  const dated: { range: DateRange; role: ScreenRole }[] = [];
  for (const role of reply.roles) {
    const range = parseRange(role.start, role.end, now);
    if (range) dated.push({ range, role });
  }
  const ranges = dated.filter((d) => d.role.relevant).map((d) => d.range);
  return {
    ranges,
    dated,
    years: ranges.length > 0 ? yearsCovered(ranges) : null,
    recentMonths: monthsSinceLatest(ranges, now),
  };
}

/** Sector words overlap, plurals folded — "fintech, payments" against "payment processing". */
export function sectorMatches(sector: string | null, items: string[]): boolean {
  if (!sector) return false;
  const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]+/gu) ?? []).map((w) => w.replace(/s$/, '')));
  const have = words(sector);
  return items.some((item) => [...words(item)].some((w) => w.length > 2 && have.has(w)));
}

export function scoreScreening(input: ScreenScoreInput): ScreenBreakdown {
  const { rubric, reply, now } = input;
  const facts = roleFacts(reply, now);
  const byId = new Map(reply.answers.map((a) => [a.id, a]));
  const rows: ScoreRow[] = [];
  let observedLevel: string | null = null;
  let impactWeak = false;
  let coreCovered = 0;
  let skillsCovered = 0;
  let skillsStrong = 0;
  let skillsTotal = 0;

  for (const c of rubric.criteria) {
    const a = byId.get(c.id);
    const shape = answerShape(c);
    let credit: number | null = null;
    let answer = '—';
    let detail = '';
    let gate: ScoreRow['gate'] = null;
    let quote: string | null = a?.quote ?? null;
    let question: string | null = a?.question ?? null;

    switch (shape) {
      case 'rung': {
        const rung = a?.rung ?? 'absent';
        credit = SCREEN_SCORING.rungCredit[rung];
        answer = rung;
        if (c.kind === 'skill') {
          skillsTotal++;
          if (rung !== 'absent') skillsCovered++;
          if (rank(rung) >= rank('role')) skillsStrong++;
          if (c.spec.core && rung !== 'absent') coreCovered++;
          const months = a?.last_used ? monthsSince(a.last_used, now) : null;
          if (c.spec.recentWithinMonths !== null && months !== null && months > c.spec.recentWithinMonths) {
            credit = round1(credit * SCREEN_SCORING.staleFactor * 100) / 100;
            detail = `last used ${describeMonths(months)} — past the ${c.spec.recentWithinMonths}-month window, half credit`;
          } else if (a?.last_used) detail = `last used ${a.last_used}`;
          gate = rank(rung) >= rank(c.spec.minRung) && rung !== 'absent' ? 'pass' : 'fail';
        } else {
          gate = rung === 'absent' ? 'fail' : rank(rung) >= rank('project') ? 'pass' : 'unknown';
        }
        break;
      }
      case 'status': {
        const status = a?.status ?? 'unknown';
        answer = status;
        credit = status === 'unknown' ? null : SCREEN_SCORING.statusCredit[status];
        gate = status === 'partial' ? 'unknown' : status;
        if (status === 'unknown') detail = question ? `ask: ${question}` : 'the resume does not say — ask';
        else if (a?.note) detail = a.note;
        break;
      }
      case 'level': {
        const observed = a?.level ?? null;
        observedLevel = observed;
        const wanted = c.spec.wanted;
        if (!observed || !wanted) {
          credit = null;
          answer = observed ?? 'too little to say';
          detail = observed ? 'the criterion names no level' : 'too little to say — ask';
          gate = 'unknown';
          break;
        }
        const diff = SCREEN_LEVELS.indexOf(observed) - SCREEN_LEVELS.indexOf(wanted);
        credit = levelCredit(diff, c.spec.tolerance);
        answer = observed;
        detail = `reads as ${observed}; the criterion asks ${wanted}${c.spec.tolerance === 'atLeast' ? ' or above' : c.spec.tolerance === 'atMost' ? ' or below' : c.spec.tolerance === 'one' ? ' (one rung either way)' : ' exactly'}`;
        gate = credit >= 1 ? 'pass' : credit > 0 ? 'unknown' : 'fail';
        break;
      }
      case 'impact': {
        const grade = a?.impact ?? 'weak';
        credit = SCREEN_SCORING.impactCredit[grade];
        answer = grade;
        impactWeak = grade === 'weak';
        detail = quote ? 'an outcome line quoted' : 'no outcome line quoted';
        gate = grade === 'weak' ? 'fail' : 'pass';
        break;
      }
      case 'overall': {
        const grade = a?.overall ?? 'partial';
        credit = SCREEN_SCORING.overallCredit[grade];
        answer = grade;
        detail = [...(a?.reasons ?? []), ...(a?.concerns ?? []).map((x) => `concern: ${x}`)].join('; ');
        gate = grade === 'none' || grade === 'weak' ? 'fail' : 'pass';
        break;
      }
      case 'roles': {
        if (c.kind === 'years') {
          if (facts.years === null || facts.recentMonths === null) {
            credit = null;
            answer = 'no dated relevant role';
            detail = 'ask which roles were this kind of work';
            gate = 'unknown';
            break;
          }
          const { min, max } = c.spec;
          const over = max !== null && facts.years > max + 0.5;
          const share = min === null || min === 0 ? Math.min(1, facts.years) : Math.min(1, facts.years / min);
          const recency = SCREEN_SCORING.recency.find((r) => facts.recentMonths! <= r.months)?.credit ?? SCREEN_SCORING.recencyFloor;
          credit = over ? 0 : SCREEN_SCORING.yearsShare * share + SCREEN_SCORING.recencyShare * recency;
          answer = `${facts.years} years`;
          detail = `${facts.years} relevant year${facts.years === 1 ? '' : 's'}${min !== null ? ` of ${min} asked` : ''}${max !== null ? `, at most ${max}` : ''}; last ended ${describeMonths(facts.recentMonths)}`;
          gate = over ? 'fail' : min !== null && facts.years + 0.5 < min ? 'fail' : 'pass';
        } else if (c.kind === 'industry') {
          const marked = facts.dated.filter((d) => d.role.sector !== null);
          if (marked.length === 0) {
            credit = null;
            answer = 'no sector read';
            detail = 'the text names no sectors — ask';
            gate = 'unknown';
            break;
          }
          const matching = marked.filter((d) => sectorMatches(d.role.sector, c.spec.items)).map((d) => d.range);
          const years = matching.length > 0 ? yearsCovered(matching) : 0;
          const min = c.spec.min;
          credit = min !== null && min > 0 ? Math.min(1, years / min) : years > 0 ? 1 : 0;
          answer = `${years} years`;
          detail = years > 0 ? `${years} year${years === 1 ? '' : 's'} in ${c.spec.items.join(', ')}${min !== null ? ` of ${min} asked` : ''}` : `no role in ${c.spec.items.join(', ')}`;
          gate = credit >= 1 ? 'pass' : credit > 0 ? 'unknown' : 'fail';
        } else {
          // companyType: the share of dated years spent in a matching type.
          const typed = facts.dated.filter((d) => d.role.companyType !== null);
          if (typed.length === 0) {
            credit = null;
            answer = 'no company type read';
            detail = 'the text does not say what kind of companies — ask';
            gate = 'unknown';
            break;
          }
          const all = yearsCovered(typed.map((d) => d.range));
          const matching = typed.filter((d) => c.spec.items.some((t) => t.toLowerCase() === d.role.companyType));
          const share = all > 0 ? Math.min(1, yearsCovered(matching.map((d) => d.range)) / all) : 0;
          credit = round1(share * 100) / 100;
          answer = `${Math.round(share * 100)}% of the years`;
          detail = matching.length > 0 ? `${matching.length} of ${typed.length} dated roles at ${c.spec.items.join(' / ')} companies` : `no role at ${c.spec.items.join(' / ')} companies`;
          gate = share > 0 ? 'pass' : 'fail';
        }
        break;
      }
    }

    const max = c.mode === 'scored' && credit !== null ? c.weight : 0;
    rows.push({
      id: c.id,
      kind: c.kind,
      label: c.label,
      mode: c.mode,
      weight: c.weight,
      credit,
      pts: max === 0 ? 0 : round1(max * credit!),
      max,
      gate: c.mode === 'gate' ? gate : null,
      answer,
      quote,
      detail,
      question,
    });
  }

  // Gates — the bucket, never points.
  const gates = rows.filter((r) => r.mode === 'gate');
  const gatesFailed = gates.filter((r) => r.gate === 'fail').map((r) => r.label);
  const gatesUnknown = gates.filter((r) => r.gate === 'unknown' || r.gate === null).map((r) => r.label);
  const gateBucket: GateBucket = gatesFailed.length > 0 ? 'fail' : gatesUnknown.length > 0 ? 'ask' : 'pass';

  // The sum over the scored criteria the text could answer.
  const scored = rows.filter((r) => r.mode === 'scored');
  const weightTotal = scored.reduce((n, r) => n + r.max, 0);
  const earned = scored.reduce((n, r) => n + r.pts, 0);
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
  const core = coreCriteria(rubric);
  if (core.length > 0 && coreCovered === 0) apply(SCREEN_SCORING.caps.coreNone, 'core');
  const levelRow = rubric.criteria.find((c) => c.kind === 'level');
  if (levelRow?.spec.wanted && observedLevel && levelRow.spec.tolerance !== 'atMost') {
    if (SCREEN_LEVELS.indexOf(levelRow.spec.wanted) - SCREEN_LEVELS.indexOf(observedLevel as (typeof SCREEN_LEVELS)[number]) >= 2) apply(SCREEN_SCORING.caps.twoLevelsUnder, 'level');
  }
  if (impactWeak && facts.ranges.length > 0 && rubric.criteria.some((c) => c.kind === 'impact')) apply(SCREEN_SCORING.caps.impactWeak, 'impact');
  const score = Math.max(0, Math.min(100, cap === null ? raw : Math.min(raw, cap)));

  const thin = input.textChars < SCREEN_SCORING.thinChars;
  const counted = rows.filter((r) => r.mode !== 'note');
  const answered = counted.filter((r) => (r.mode === 'gate' ? r.gate === 'pass' || r.gate === 'fail' : r.credit !== null)).length;
  const value = round1((counted.length === 0 ? 1 : answered / counted.length) * (thin ? SCREEN_SCORING.thinFactor : 1) * 100) / 100;
  const band: ConfidenceBand = value >= SCREEN_SCORING.confidence.high ? 'high' : value >= SCREEN_SCORING.confidence.medium ? 'medium' : 'low';

  return {
    v: SCREEN_SCORING.version,
    score,
    cap,
    capReason,
    rows,
    weightTotal,
    gateBucket,
    gatesFailed,
    gatesUnknown,
    skillsCovered,
    skillsStrong,
    skillsTotal,
    coreCovered,
    coreTotal: core.length,
    years: facts.years,
    recentMonths: facts.recentMonths,
    level: observedLevel,
    confidence: { value, band, answered, total: counted.length, thin },
  };
}

/** Distance between the observed and the wanted rung, read through the criterion's tolerance. */
export function levelCredit(diff: number, tolerance: Criterion['spec']['tolerance']): number {
  switch (tolerance) {
    case 'exact':
      return diff === 0 ? 1 : Math.abs(diff) === 1 ? 0.5 : 0;
    case 'one':
      return Math.abs(diff) <= 1 ? 1 : Math.abs(diff) === 2 ? 0.25 : 0;
    case 'atLeast':
      return diff >= 0 ? 1 : diff === -1 ? 0.5 : 0;
    case 'atMost':
      return diff <= 0 ? 1 : diff === 1 ? 0.5 : 0;
  }
}

function monthsSince(dateText: string, now: Date): number | null {
  const d = parseResumeDate(dateText);
  if (!d) return null;
  if (d === 'present') return 0;
  return Math.max(0, now.getUTCFullYear() * 12 + now.getUTCMonth() - (d.year * 12 + ((d.month ?? 12) - 1)));
}

function describeMonths(months: number): string {
  if (months <= 1) return 'this month';
  if (months < 24) return `${months} months ago`;
  return `${Math.round(months / 12)} years ago`;
}

/** Plain-words reason for the cap — the table must never show a number it cannot explain. */
export function capExplanation(bd: ScreenBreakdown): string | null {
  switch (bd.capReason) {
    case 'core':
      return `Capped at ${bd.cap}: none of the ${bd.coreTotal} core-stack skill${bd.coreTotal === 1 ? '' : 's'} is anywhere in the resume.`;
    case 'level':
      return `Capped at ${bd.cap}: the text reads two levels below the level the criterion asks for.`;
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

/* Stored JSON. */

const RowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  mode: z.enum(CRITERION_MODES),
  weight: z.number(),
  credit: z.number().nullable(),
  pts: z.number(),
  max: z.number(),
  gate: z.enum(['pass', 'unknown', 'fail']).nullable(),
  answer: z.string(),
  quote: z.string().nullable(),
  detail: z.string().default(''),
  question: z.string().nullable(),
});

const BreakdownSchema = z.object({
  v: z.literal(2),
  score: z.number(),
  cap: z.number().nullable(),
  capReason: z.enum(['core', 'level', 'impact']).nullish().transform((x) => x ?? null),
  rows: z.array(RowSchema),
  weightTotal: z.number(),
  gateBucket: z.enum(['pass', 'ask', 'fail']),
  gatesFailed: z.array(z.string()).default([]),
  gatesUnknown: z.array(z.string()).default([]),
  skillsCovered: z.number().int(),
  skillsStrong: z.number().int(),
  skillsTotal: z.number().int(),
  coreCovered: z.number().int(),
  coreTotal: z.number().int(),
  years: z.number().nullable(),
  recentMonths: z.number().nullable(),
  level: z.string().nullable(),
  confidence: z.object({ value: z.number(), band: z.enum(['high', 'medium', 'low']), answered: z.number().int(), total: z.number().int(), thin: z.boolean().default(false) }),
});

/** Reader for the stored column; a v1 breakdown reads as null — its verdict is stale. */
export function readScreenBreakdown(value: unknown): ScreenBreakdown | null {
  const r = BreakdownSchema.safeParse(value);
  return r.success ? (r.data as ScreenBreakdown) : null;
}
