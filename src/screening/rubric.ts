import { z } from 'zod';
import type { PostingBrief } from '../resume/prompts';

/*
 * What a screening checks (TASKS §19, ADR 0047). Drafted from the posting
 * brief — the same reading the candidate side already keeps per posting
 * (ADR 0044) — and edited by the person before anything is scored. Pure: a
 * schema, a draft, a form reader and a one-line summary; no I/O.
 *
 * The rubric is the yardstick every applicant is measured with, so it is
 * stored on the screening and versioned: a verdict records the version it
 * was scored under, and a changed rubric makes every stored verdict stale.
 */

export const SCREEN_LEVELS = ['junior', 'mid', 'senior', 'lead'] as const;
export type ScreenLevel = (typeof SCREEN_LEVELS)[number];

export const SCREEN_LEVEL_LABELS: Record<ScreenLevel, string> = {
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  lead: 'Lead / staff',
};

/** The seven parts of the score (score.ts), in the order the page shows them. */
export const RUBRIC_PARTS = ['must', 'years', 'level', 'impact', 'domain', 'nice', 'education'] as const;
export type RubricPart = (typeof RUBRIC_PARTS)[number];

export const RUBRIC_PART_LABELS: Record<RubricPart, string> = {
  must: 'Must-have skills',
  years: 'Relevant years and recency',
  level: 'Level and scope',
  impact: 'Impact evidence',
  domain: 'Domain',
  nice: 'Nice-to-have skills',
  education: 'Education, certificates',
};

/** The plan's starting weights (hr-screening-plan.md §4, layer 2). */
export const DEFAULT_WEIGHTS: Record<RubricPart, number> = {
  must: 35,
  years: 15,
  level: 15,
  impact: 15,
  domain: 10,
  nice: 5,
  education: 5,
};

const MAX_GATES = 12;
const MAX_TERMS = 30;
const MAX_TERM_CHARS = 60;
const MAX_GATE_CHARS = 200;
const MAX_WEIGHT = 100;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

const TermSchema = z.object({
  term: trimmed(MAX_TERM_CHARS),
  /** Part of the core stack — the stack cap's question (score.ts). */
  primary: z.boolean().default(false),
  aliases: z.array(z.string().trim().min(1).max(MAX_TERM_CHARS)).max(8).default([]),
  /** An either/or group from the brief (ADR 0044): members are counted once. */
  group: z.string().trim().min(1).max(MAX_TERM_CHARS).nullable().default(null),
});
export type RubricTerm = z.infer<typeof TermSchema>;

const WeightsSchema = z
  .object(
    Object.fromEntries(
      RUBRIC_PARTS.map((p) => [p, z.number().int().min(0).max(MAX_WEIGHT).default(DEFAULT_WEIGHTS[p])]),
    ) as Record<RubricPart, z.ZodDefault<z.ZodNumber>>,
  )
  .default(DEFAULT_WEIGHTS);

export const RubricSchema = z.object({
  /** The level the posting hires at; null when it does not say — then the level part weighs nothing. */
  level: z.enum(SCREEN_LEVELS).nullable().default(null),
  yearsMin: z.number().int().min(0).max(40).nullable().default(null),
  /** Checkable statements marked pass / unknown / fail; never points. */
  gates: z.array(trimmed(MAX_GATE_CHARS)).max(MAX_GATES).default([]),
  must: z.array(TermSchema).max(MAX_TERMS).default([]),
  nice: z.array(TermSchema).max(MAX_TERMS).default([]),
  /** The sector the posting is in; null when it does not say — then the domain part weighs nothing. */
  domain: z.string().trim().min(1).max(120).nullable().default(null),
  /** Only a posting that really requires a degree or a certificate scores education. */
  educationRequired: z.boolean().default(false),
  weights: WeightsSchema,
});
export type Rubric = z.infer<typeof RubricSchema>;

export function emptyRubric(): Rubric {
  return RubricSchema.parse({});
}

/** Reads the stored column; an unreadable value is an empty rubric, never a crash. */
export function readRubric(value: unknown): Rubric {
  const parsed = RubricSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyRubric();
}

/** The brief's seniority vocabulary folded to the four rungs the score can compare. */
export function levelFromBrief(seniority: string | null): ScreenLevel | null {
  if (!seniority) return null;
  const s = seniority.toLowerCase();
  if (/junior|entry|intern/.test(s)) return 'junior';
  if (/mid|intermediate|regular/.test(s)) return 'mid';
  if (/staff|lead|principal|head|architect/.test(s)) return 'lead';
  if (/senior/.test(s)) return 'senior';
  return null;
}

const EDUCATION_WORDS = /\b(degree|bachelor|master|bsc|msc|b\.s\.|m\.s\.|phd|diploma|certif|licen[cs]e|clearance)\b/i;

/**
 * The first rubric, from the posting's own reading. Must-have terms are the
 * brief's `must` keywords, nice-to-have the `preferred` and `nice` ones;
 * `context` terms are not requirements. Without a brief the rubric is empty
 * and the page asks the person to write it.
 */
export function draftRubric(brief: PostingBrief | null): Rubric {
  if (!brief) return emptyRubric();
  const term = (k: PostingBrief['keywords'][number]): RubricTerm => ({
    term: k.term,
    primary: k.primary && k.requirement === 'must',
    aliases: k.aliases.slice(0, 8),
    group: k.group,
  });
  const must = brief.keywords.filter((k) => k.requirement === 'must').map(term);
  const nice = brief.keywords.filter((k) => k.requirement === 'preferred' || k.requirement === 'nice').map(term);
  return RubricSchema.parse({
    level: levelFromBrief(brief.role.seniority),
    yearsMin: brief.role.years_min,
    gates: brief.gates.slice(0, MAX_GATES),
    must: must.slice(0, MAX_TERMS),
    nice: nice.slice(0, MAX_TERMS),
    domain: brief.company.industry,
    educationRequired: brief.gates.some((g) => EDUCATION_WORDS.test(g)),
  });
}

/** Newline-separated textarea → distinct trimmed lines. */
export function linesOf(input: unknown): string[] {
  if (typeof input !== 'string') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    const key = line.toLowerCase();
    if (line.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/** Comma- or newline-separated input → distinct trimmed terms. */
export function termsOf(input: unknown): string[] {
  if (typeof input !== 'string') return [];
  return linesOf(input.replace(/[,;]/g, '\n'));
}

/**
 * The editor's fields → a rubric. Terms typed by the person keep the
 * aliases and group of the term they replace when the spelling matches, so
 * an edit to one line does not lose the brief's synonyms for the others.
 */
export function rubricFromForm(form: Record<string, unknown>, previous: Rubric): Rubric {
  const known = new Map<string, RubricTerm>();
  for (const t of [...previous.must, ...previous.nice]) known.set(t.term.toLowerCase(), t);
  const core = new Set(termsOf(form.core).map((t) => t.toLowerCase()));
  const toTerm = (term: string): RubricTerm => {
    const old = known.get(term.toLowerCase());
    return { term, primary: core.has(term.toLowerCase()), aliases: old?.aliases ?? [], group: old?.group ?? null };
  };
  const level = typeof form.level === 'string' && (SCREEN_LEVELS as readonly string[]).includes(form.level) ? form.level : null;
  const years = typeof form.yearsMin === 'string' && form.yearsMin.trim() !== '' ? Number(form.yearsMin) : null;
  const weights = Object.fromEntries(
    RUBRIC_PARTS.map((p) => {
      const raw = form[`weight_${p}`];
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : previous.weights[p];
      return [p, Number.isFinite(n) ? Math.max(0, Math.min(MAX_WEIGHT, Math.round(n))) : previous.weights[p]];
    }),
  );
  return RubricSchema.parse({
    level,
    yearsMin: years !== null && Number.isFinite(years) ? Math.max(0, Math.min(40, Math.round(years))) : null,
    gates: linesOf(form.gates).slice(0, MAX_GATES).map((g) => g.slice(0, MAX_GATE_CHARS)),
    must: termsOf(form.must).slice(0, MAX_TERMS).map((t) => toTerm(t.slice(0, MAX_TERM_CHARS))),
    nice: termsOf(form.nice).slice(0, MAX_TERMS).map((t) => toTerm(t.slice(0, MAX_TERM_CHARS))),
    domain: typeof form.domain === 'string' && form.domain.trim() !== '' ? form.domain.trim().slice(0, 120) : null,
    educationRequired: form.educationRequired === 'on' || form.educationRequired === '1' || form.educationRequired === 'true',
    weights,
  });
}

/** Same yardstick or not — what decides whether a save bumps the version. */
export function rubricEquals(a: Rubric, b: Rubric): boolean {
  return JSON.stringify(RubricSchema.parse(a)) === JSON.stringify(RubricSchema.parse(b));
}

/** "7 gates · 9 must-have · 4 nice-to-have · senior · 5+ years · fintech" */
export function rubricSummary(r: Rubric): string {
  const parts = [
    `${r.gates.length} gate${r.gates.length === 1 ? '' : 's'}`,
    `${r.must.length} must-have`,
    `${r.nice.length} nice-to-have`,
  ];
  if (r.level) parts.push(SCREEN_LEVEL_LABELS[r.level].toLowerCase());
  if (r.yearsMin !== null) parts.push(`${r.yearsMin}+ years`);
  if (r.domain) parts.push(r.domain);
  if (r.educationRequired) parts.push('education required');
  return parts.join(' · ');
}

/** The weights that count, given what the rubric knows — a part with nothing to compare weighs nothing. */
export function activeWeights(r: Rubric): Record<RubricPart, number> {
  return {
    ...r.weights,
    level: r.level ? r.weights.level : 0,
    domain: r.domain ? r.weights.domain : 0,
    education: r.educationRequired ? r.weights.education : 0,
    nice: r.nice.length > 0 ? r.weights.nice : 0,
    must: r.must.length > 0 ? r.weights.must : 0,
  };
}
