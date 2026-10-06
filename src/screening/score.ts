import { z } from 'zod';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';
import { sectorMatches } from './sectors';
import { monthsSinceLatest, parseRange, parseResumeDate, yearsCovered, type DateRange } from './dates';
import { answerShape, type ImpactGrade, type OverallGrade, type ScreenAnswer, type ScreenReply, type ScreenRole } from './prompts';
import { coreCriteria, CRITERION_MODES, EVIDENCE_RUNGS, SCREEN_LEVELS, wordedTable, type Criterion, type EvidenceRung, type Rubric } from './rubric';

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

const SCREEN_SCORING = {
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
/** Worded when read (rubric.ts:wordedTable); the export reads it under `withLocale('en')`. */
export const GATE_BUCKET_LABELS = wordedTable<GateBucket>({
  pass: 'screening.bucket.pass',
  ask: 'screening.bucket.ask',
  fail: 'screening.bucket.fail',
});
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
  const cap = bd.cap ?? '';
  switch (bd.capReason) {
    case 'core':
      return t('screening.cap.core', { cap, n: bd.coreTotal });
    case 'level':
      return t('screening.cap.level', { cap });
    case 'impact':
      return t('screening.cap.impact', { cap });
    default:
      return null;
  }
}

/*
 * A row's `answer` and `detail` are stored as scoreScreening wrote them, in
 * English: they are data, and the export reads them as they are. A page words
 * them on the way out — the shapes below are the ones written above, and
 * anything else (the model's own note, a level) is shown as it was stored.
 */

const ANSWER_WORDS: Record<string, MessageKey> = {
  absent: 'screening.answer.absent',
  listed: 'screening.answer.listed',
  project: 'screening.answer.project',
  role: 'screening.answer.role',
  production: 'screening.answer.production',
  pass: 'screening.answer.pass',
  partial: 'screening.answer.partial',
  unknown: 'screening.answer.unknown',
  fail: 'screening.answer.fail',
  strong: 'screening.answer.strong',
  ok: 'screening.answer.ok',
  weak: 'screening.answer.weak',
  exceptional: 'screening.answer.exceptional',
  none: 'screening.answer.none',
  'too little to say': 'screening.answer.tooLittle',
  'no dated relevant role': 'screening.answer.noDatedRole',
  'no sector read': 'screening.answer.noSector',
  'no company type read': 'screening.answer.noCompanyType',
};

const RUNG_SHORT_WORDS: Record<EvidenceRung, MessageKey> = {
  absent: 'screening.rungShort.absent',
  listed: 'screening.rungShort.listed',
  project: 'screening.rungShort.project',
  role: 'screening.rungShort.role',
  production: 'screening.rungShort.production',
};

const NUMBER = '(\\d+(?:\\.\\d+)?)';
const YEARS_ANSWER = new RegExp(`^${NUMBER} years$`);
const SHARE_ANSWER = /^(\d+)% of the years$/;

/** A stored answer in the reader's language: "role", "pass", "strong", "9.8 years"; a level stays as written. */
export function answerWords(answer: string): string {
  if (Object.hasOwn(ANSWER_WORDS, answer)) return t(ANSWER_WORDS[answer]!);
  const years = YEARS_ANSWER.exec(answer);
  if (years) return t('screening.answer.years', { n: Number(years[1]) });
  const share = SHARE_ANSWER.exec(answer);
  if (share) return t('screening.answer.shareOfYears', { pct: Number(share[1]) });
  return answer;
}

/** The badge's word: a rung in its short form ("skills list"), any other answer as `answerWords` gives it. */
export function answerBadge(answer: string): string {
  return Object.hasOwn(RUNG_SHORT_WORDS, answer) ? t(RUNG_SHORT_WORDS[answer as EvidenceRung]) : answerWords(answer);
}

const DETAIL_WORDS: Record<string, MessageKey> = {
  'the resume does not say — ask': 'screening.detail.resumeSilent',
  'the criterion names no level': 'screening.detail.noLevelAsked',
  'too little to say — ask': 'screening.detail.tooLittle',
  'an outcome line quoted': 'screening.detail.outcomeQuoted',
  'no outcome line quoted': 'screening.detail.noOutcomeQuoted',
  'ask which roles were this kind of work': 'screening.detail.askRoles',
  'the text names no sectors — ask': 'screening.detail.noSectors',
  'the text does not say what kind of companies — ask': 'screening.detail.noCompanyTypes',
};

const WHEN = '(this month|\\d+ months ago|\\d+ years ago)';
const LEVEL = `(${SCREEN_LEVELS.join('|')})`;
const DETAIL_STALE = new RegExp(`^last used ${WHEN} — past the (\\d+)-month window, half credit$`);
const DETAIL_LAST_USED = /^last used (.+)$/s;
const DETAIL_ASK = /^ask: (.+)$/s;
const DETAIL_LEVEL = new RegExp(`^reads as ${LEVEL}; the criterion asks ${LEVEL}( or above| or below| \\(one rung either way\\)| exactly)$`);
const DETAIL_YEARS = new RegExp(`^${NUMBER} relevant years?(?: of ${NUMBER} asked)?(?:, at most ${NUMBER})?; last ended ${WHEN}$`);
const DETAIL_INDUSTRY = new RegExp(`^${NUMBER} years? in (.+?)(?: of ${NUMBER} asked)?$`, 's');
const DETAIL_NO_ROLE_IN = /^no role in (.+)$/s;
const DETAIL_COMPANY = /^(\d+) of (\d+) dated roles at (.+) companies$/s;
const DETAIL_NO_ROLE_AT = /^no role at (.+) companies$/s;
const TOLERANCE: Record<string, string> = { ' or above': 'atLeast', ' or below': 'atMost', ' (one rung either way)': 'one', ' exactly': 'exact' };

/** "this month" / "3 months ago" / "2 years ago", as describeMonths wrote it. */
function whenWords(when: string): string {
  const n = Number(/\d+/.exec(when)?.[0]);
  if (when.endsWith('months ago')) return t('screening.detail.monthsAgo', { n });
  if (when.endsWith('years ago')) return t('screening.detail.yearsAgo', { n });
  return t('screening.detail.thisMonth');
}

const optional = (n: string | undefined): string | number => (n === undefined ? 'none' : Number(n));

/** A stored detail in the reader's language; the model's own words inside it stay as written. */
export function detailWords(detail: string): string {
  if (Object.hasOwn(DETAIL_WORDS, detail)) return t(DETAIL_WORDS[detail]!);
  let m = DETAIL_STALE.exec(detail);
  if (m) return t('screening.detail.stale', { when: whenWords(m[1]!), window: Number(m[2]) });
  if ((m = DETAIL_LEVEL.exec(detail))) return t('screening.detail.level', { observed: m[1]!, wanted: m[2]!, tolerance: TOLERANCE[m[3]!] ?? 'exact' });
  if ((m = DETAIL_YEARS.exec(detail))) {
    return t('screening.detail.years', { years: Number(m[1]), min: optional(m[2]), max: optional(m[3]), when: whenWords(m[4]!) });
  }
  if ((m = DETAIL_COMPANY.exec(detail))) return t('screening.detail.companyType', { n: Number(m[1]), total: Number(m[2]), items: m[3]! });
  if ((m = DETAIL_NO_ROLE_AT.exec(detail))) return t('screening.detail.noRoleAt', { items: m[1]! });
  if ((m = DETAIL_INDUSTRY.exec(detail))) return t('screening.detail.industry', { years: Number(m[1]), items: m[2]!, min: optional(m[3]) });
  if ((m = DETAIL_NO_ROLE_IN.exec(detail))) return t('screening.detail.noRoleIn', { items: m[1]! });
  if ((m = DETAIL_LAST_USED.exec(detail))) return t('screening.detail.lastUsed', { date: m[1]! });
  if ((m = DETAIL_ASK.exec(detail))) return t('screening.detail.ask', { question: m[1]! });
  // The overall read: the model's reasons, its concerns marked by us.
  return detail
    .split('; ')
    .map((part) => (part.startsWith('concern: ') ? t('screening.detail.concern', { text: part.slice('concern: '.length) }) : part))
    .join('; ');
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
