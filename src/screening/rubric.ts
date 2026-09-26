import { z } from 'zod';
import type { PostingBrief } from '../resume/prompts';

/*
 * What a screening checks (TASKS §19.5, ADR 0050): a list of CRITERIA the
 * person chooses for this vacancy. Each criterion has a kind (what is
 * read), a mode (a gate that buckets, stars that score, or a note that
 * only shows) and, for the kinds that need it, a spec. Drafted from the
 * posting brief (ADR 0044), edited in the person's own words, versioned:
 * a verdict records the rubric version it was scored under, and a changed
 * rubric makes every stored verdict stale.
 *
 * Everything in HR's own words is a criterion the model answers with a
 * quote — never an instruction it follows (ADR 0022). A criterion that
 * names a protected characteristic is refused at save with the lawful
 * criterion that stands behind the wish (docs/screening-criteria-plan.md
 * §2.4). Pure: schema, draft, presets, the text grammar, equality, a
 * summary; no I/O.
 *
 * One grammar reads every row, whoever writes it — the person, the draft, a
 * preset, a v1 rubric — so the editor's text for a row reads back into the
 * same row, and the editor saved as it is rendered changes nothing.
 */

export const RUBRIC_VERSION = 2;

export const SCREEN_LEVELS = ['junior', 'mid', 'senior', 'lead'] as const;
export type ScreenLevel = (typeof SCREEN_LEVELS)[number];
/** How strongly a text evidences a term, lowest first — the ladder the skill kinds are answered on. */
export const EVIDENCE_RUNGS = ['absent', 'listed', 'project', 'role', 'production'] as const;
export type EvidenceRung = (typeof EVIDENCE_RUNGS)[number];
export const EVIDENCE_RUNG_LABELS: Record<EvidenceRung, string> = {
  absent: 'not in the resume',
  listed: 'skills list only',
  project: 'project or study',
  role: 'used in a role',
  production: 'owned in production',
};

export const CRITERION_KINDS = [
  'skill',
  'years',
  'level',
  'industry',
  'companyType',
  'language',
  'location',
  'authorization',
  'availability',
  'education',
  'certification',
  'scale',
  'impact',
  'overall',
  'custom',
] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

export const CRITERION_KIND_LABELS: Record<CriterionKind, string> = {
  skill: 'Skill',
  years: 'Years of experience',
  level: 'Level',
  industry: 'Industry',
  companyType: 'Company type',
  language: 'Language',
  location: 'Location',
  authorization: 'Work permit',
  availability: 'Availability',
  education: 'Education',
  certification: 'Certification',
  scale: 'Scale',
  impact: 'Impact evidence',
  overall: 'Overall read',
  custom: 'In my own words',
};

/** What the editor's "What" field takes for each kind — the grammar `parseCriterionText` reads. */
export const CRITERION_KIND_HINTS: Record<CriterionKind, string> = {
  skill: 'one term, or alternatives as "Playwright / Cypress"; add "!" to mark the core stack; add "within 36 months" to halve the credit for older use',
  years: '"5+", "0–2", "3–5" — years in this kind of work; add the kind after a colon: "5+: test automation"',
  level: 'junior, mid, senior or lead; add "or above" / "or below" / "exactly"',
  industry: 'sectors, comma-separated; optional years: "fintech, payments: 3+"',
  companyType: 'product, agency, consultancy, startup, enterprise, public sector, non-profit',
  language: '"English B2", "Ukrainian native"',
  location: 'a city or country; add "or remote"',
  authorization: 'the country: "Ukraine", "EU", "United States"',
  availability: '"within 4 weeks"',
  education: '"bachelor: computer science, software engineering"',
  certification: 'names, comma-separated',
  scale: 'what and how much: "team of 5+", "1M users", "10k requests/s"',
  impact: 'outcomes with numbers versus duties — nothing to type',
  overall: 'the model reads the whole resume against the whole posting — nothing to type',
  custom: 'a question the resume can answer: "has led a team of three or more"',
};

export const CRITERION_MODES = ['gate', 'scored', 'note'] as const;
export type CriterionMode = (typeof CRITERION_MODES)[number];
export const CRITERION_MODE_LABELS: Record<CriterionMode, string> = {
  gate: 'Gate — pass / unknown / fail, never points',
  scored: 'Scored — weighted by the stars',
  note: 'Note — shown, not counted',
};

/** How each kind is answered — the reply's shape per criterion (prompts.ts) and the credit rule (score.ts). */
export const KIND_ANSWER: Record<CriterionKind, 'status' | 'rung' | 'level' | 'impact' | 'overall' | 'years' | 'industry' | 'companyType'> = {
  skill: 'rung',
  years: 'years',
  level: 'level',
  industry: 'industry',
  companyType: 'companyType',
  language: 'status',
  location: 'status',
  authorization: 'status',
  availability: 'status',
  education: 'status',
  certification: 'status',
  scale: 'status',
  impact: 'impact',
  overall: 'overall',
  custom: 'status',
};

const LEVEL_TOLERANCES = ['exact', 'one', 'atLeast', 'atMost'] as const;
export type LevelTolerance = (typeof LEVEL_TOLERANCES)[number];

export const COMPANY_TYPES = ['product', 'agency', 'consultancy', 'startup', 'enterprise', 'public sector', 'non-profit'] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

const MAX_CRITERIA = 40;
const MAX_CUSTOM = 20;
const MAX_TEXT = 200;
const MAX_TERM = 60;
const MAX_ALIASES = 8;
/** A years band or an industry's years: the schema's ceiling, which a larger number is clamped to. */
const MAX_YEARS = 60;
/** Posting rows the person removed, remembered by label; past this the oldest is forgotten. */
const MAX_REMOVED = 60;
export const MAX_WEIGHT = 5;
/** A skill's recency window, in months: "within 36 months", or "within 3 years" read as 36. */
const MIN_WINDOW_MONTHS = 1;
const MAX_WINDOW_MONTHS = 240;
const MONTHS_PER_YEAR = 12;

const term = z.string().trim().min(1).max(MAX_TERM);
const text = z.string().trim().min(1).max(MAX_TEXT);

const SpecSchema = z
  .object({
    /** skill: one term, or the members of an either/or group. */
    terms: z.array(z.object({ term, aliases: z.array(term).max(MAX_ALIASES).default([]) })).max(12).default([]),
    /** skill: part of the core stack — none of the core anywhere caps the score at 30. */
    core: z.boolean().default(false),
    /** skill: the rung a gate needs (a scored skill takes the ladder as it is). */
    minRung: z.enum(EVIDENCE_RUNGS).default('listed'),
    /** skill: a term last used longer ago than this earns half. Null = no decay — off unless the text says "within N months". */
    recentWithinMonths: z.number().int().min(MIN_WINDOW_MONTHS).max(MAX_WINDOW_MONTHS).nullable().default(null),
    /** years: the kind of work that counts, and the band. */
    of: z.string().trim().max(MAX_TEXT).nullable().default(null),
    min: z.number().min(0).max(MAX_YEARS).nullable().default(null),
    max: z.number().min(0).max(MAX_YEARS).nullable().default(null),
    /** level. */
    wanted: z.enum(SCREEN_LEVELS).nullable().default(null),
    tolerance: z.enum(LEVEL_TOLERANCES).default('one'),
    /** industry, certification, education fields, location places, companyType types. */
    items: z.array(text).max(12).default([]),
    /** location: remote counts as being there. */
    remoteOk: z.boolean().default(false),
    /** language: the level; education: the degree level; scale: the threshold; availability: weeks. */
    level: z.string().trim().max(MAX_TERM).nullable().default(null),
    /** custom: the question, and whether it is answered yes / no or on the evidence ladder. */
    question: z.string().trim().max(MAX_TEXT).nullable().default(null),
    answer: z.enum(['yesno', 'howmuch']).default('yesno'),
  })
  .default({});
export type CriterionSpec = z.infer<typeof SpecSchema>;
/** A spec from a partial — the tests and the presets build criteria by hand. */
export function specOf(partial: Partial<CriterionSpec> = {}): CriterionSpec {
  return SpecSchema.parse(partial);
}

const CriterionSchema = z.object({
  id: z.string().trim().min(1).max(24),
  kind: z.enum(CRITERION_KINDS),
  /** What the row says — the "What" column, written by the person or drafted from the posting. */
  label: z.string().trim().max(MAX_TEXT).default(''),
  mode: z.enum(CRITERION_MODES).default('scored'),
  weight: z.number().int().min(1).max(MAX_WEIGHT).default(3),
  source: z.enum(['posting', 'you']).default('you'),
  spec: SpecSchema,
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const RubricSchema = z.object({
  version: z.literal(RUBRIC_VERSION).default(RUBRIC_VERSION),
  criteria: z.array(CriterionSchema).max(MAX_CRITERIA).default([]),
  /** Posting-drafted criteria the person removed, by label — a redraft does not resurrect them. */
  removed: z.array(z.string()).max(MAX_REMOVED).default([]),
});
export type Rubric = z.infer<typeof RubricSchema>;

export function emptyRubric(): Rubric {
  return RubricSchema.parse({});
}

let seq = 0;
/** Short, unique within a rubric, stable across saves: the reply and the verdicts key on it. */
function newCriterionId(kind: CriterionKind, taken: Set<string> = new Set()): string {
  for (;;) {
    seq = (seq + 1) % 100_000;
    const id = `${kind.slice(0, 4)}-${Date.now().toString(36).slice(-4)}${seq.toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

/* ---------- the stored column: v2, or a v1 rubric converted on read ---------- */

const V1Schema = z.object({
  level: z.enum(SCREEN_LEVELS).nullable().default(null),
  yearsMin: z.number().int().nullable().default(null),
  gates: z.array(z.string()).default([]),
  must: z.array(z.object({ term: z.string(), primary: z.boolean().default(false), aliases: z.array(z.string()).default([]), group: z.string().nullable().default(null) })).default([]),
  nice: z.array(z.object({ term: z.string(), primary: z.boolean().default(false), aliases: z.array(z.string()).default([]), group: z.string().nullable().default(null) })).default([]),
  domain: z.string().nullable().default(null),
  educationRequired: z.boolean().default(false),
});

/** Reads the stored column; a v1 rubric (v2.0.0 / v2.1.0) becomes criteria; anything unreadable is empty. */
export function readRubric(value: unknown): Rubric {
  const v2 = RubricSchema.safeParse(value);
  if (v2.success && typeof value === 'object' && value !== null && (value as { version?: unknown }).version === RUBRIC_VERSION) return v2.data;
  const v1 = V1Schema.safeParse(value);
  if (v1.success && (v1.data.must.length > 0 || v1.data.gates.length > 0)) return fromV1(v1.data);
  return emptyRubric();
}

function fromV1(v1: z.infer<typeof V1Schema>): Rubric {
  const taken = new Set<string>();
  const criteria: Criterion[] = [];
  const add = (c: Omit<Criterion, 'id'> | null): void => {
    if (!c) return;
    const id = newCriterionId(c.kind, taken);
    taken.add(id);
    criteria.push({ ...c, id });
  };
  const posting = (mode: CriterionMode, weight: number): RowShape => ({ mode, weight, source: 'posting' });
  for (const gate of v1.gates) add(written('custom', gate, posting('gate', 3)));
  for (const group of groupTerms(v1.must)) add(skillRow(group, group.some((t) => t.primary), posting('scored', 3)));
  for (const group of groupTerms(v1.nice)) add(skillRow(group, false, posting('scored', 1)));
  if (v1.yearsMin !== null) add(written('years', `${v1.yearsMin}+ years`, posting('scored', 2)));
  if (v1.level) add(written('level', `${v1.level} (one rung either way)`, posting('scored', 2)));
  if (v1.domain) add(written('industry', v1.domain, posting('scored', 2)));
  if (v1.educationRequired) add(written('education', 'a degree or certificate the posting requires', posting('gate', 3)));
  add(written('impact', '', posting('scored', 2)));
  add(written('overall', '', posting('scored', 2)));
  return RubricSchema.parse({ version: RUBRIC_VERSION, criteria: criteria.slice(0, MAX_CRITERIA) });
}

/** Terms sharing a group label become one either/or criterion; the rest stand alone. */
function groupTerms<T extends { group: string | null }>(terms: T[]): T[][] {
  const out: T[][] = [];
  const byGroup = new Map<string, T[]>();
  for (const t of terms) {
    const key = t.group?.trim().toLowerCase();
    if (!key) {
      out.push([t]);
      continue;
    }
    const group = byGroup.get(key);
    if (group) group.push(t);
    else {
      const fresh = [t];
      byGroup.set(key, fresh);
      out.push(fresh);
    }
  }
  return out;
}

/* ---------- rows the code writes: through the editor's grammar, so the editor reads them back unchanged ---------- */

type RowShape = Pick<Criterion, 'mode' | 'weight' | 'source'>;

/** A row from words, read exactly as the editor reads them; null when the kind cannot read them. */
function written(kind: CriterionKind, text: string, row: RowShape): Omit<Criterion, 'id'> | null {
  const read = parseCriterionText(kind, text);
  return read && { kind, ...row, label: read.label, spec: read.spec };
}

/** A skill row from named terms (the posting's, a v1 rubric's), each term keeping its spellings. */
function skillRow(terms: { term: string; aliases: string[] }[], core: boolean, row: RowShape): Omit<Criterion, 'id'> | null {
  const skill = written('skill', skillText(terms.map((t) => t.term), null, core), row);
  if (skill) {
    const spelled = terms.map((t) => ({ term: termOf(t.term), aliases: t.aliases.map(termOf).filter(Boolean).slice(0, MAX_ALIASES) }));
    skill.spec.terms = keepAliases(skill.spec.terms, spelled);
  }
  return skill;
}

/** A term or a spelling as a skill row keeps it: single spaces, cut to the schema's length. */
function termOf(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TERM).trim();
}

/** Each term with the spellings its namesake in `from` carries. */
function keepAliases(terms: CriterionSpec['terms'], from: { term: string; aliases: string[] }[]): CriterionSpec['terms'] {
  return terms.map((t) => ({ ...t, aliases: from.find((o) => o.term.toLowerCase() === t.term.toLowerCase())?.aliases ?? [] }));
}

/* ---------- the draft from the posting brief ---------- */

const EDUCATION_WORDS = /\b(degree|bachelor|master|bsc|msc|b\.s\.|m\.s\.|phd|diploma)\b/i;
const CERT_WORDS = /\b(certif\w*|licen[cs]e[ds]?|clearance)\b/i;
const YEARS_WORDS = /(\d+)\s*(?:\+|-|–|to)?\s*(\d+)?\s*\+?\s*years?/i;
const AUTH_WORDS = /\b(authori[sz]ed|authori[sz]ation|work permit|eligible to work|legally able|right to work|visa|sponsorship)\b/i;
const LOCATION_WORDS = /\b(located|based|on-?site|relocat|in the office|hybrid)\b/i;
const LANGUAGE_WORDS = /\b(english|ukrainian|german|polish|french|spanish|italian|dutch|portuguese|czech)\b.*\b([abc][12]|native|fluent|proficien|business)\b/i;
const AVAILABILITY_WORDS = /\b(start|available|notice period|immediately)\b/i;

/**
 * The first rubric, from the posting's own reading (ADR 0044): each must
 * keyword a scored skill (the core ones flagged), an either/or group one
 * criterion, preferred / nice ones at one star, each gate under the kind
 * its wording names, the level, the years, the sector, and the two reads
 * every screen carries — impact and the overall read. `source: 'posting'`
 * on all of it, so the editor can say which lines the posting wrote.
 */
export function draftRubric(brief: PostingBrief | null, previous: Rubric = emptyRubric()): Rubric {
  if (!brief) return emptyRubric();
  const removed = new Set(previous.removed.map((l) => l.toLowerCase()));
  const taken = new Set<string>();
  const criteria: Criterion[] = [];
  const add = (c: Omit<Criterion, 'id'> | null): void => {
    if (!c || removed.has(c.label.toLowerCase())) return;
    const id = newCriterionId(c.kind, taken);
    taken.add(id);
    criteria.push({ ...c, id });
  };
  const posting = (mode: CriterionMode, weight: number): RowShape => ({ mode, weight, source: 'posting' });
  // The posted title (or a two-word fragment of it) and the sector are not
  // skills: the title is what the rubric is FOR, the sector is the industry
  // row. A one-word term that also sits in the title ("Playwright" in
  // "QA Engineer (Playwright / TypeScript)") is a skill and stays.
  const title = brief.role.posted_title.trim().toLowerCase();
  const sector = (brief.company.industry ?? '').trim().toLowerCase();
  const skills = brief.keywords.filter((k) => {
    const t = k.term.trim().toLowerCase();
    if (t === sector) return false;
    return !(t.split(/\s+/).length >= 2 && title.includes(t));
  });
  for (const gate of brief.gates) add(written(gateKind(gate), gate, posting('gate', 3)) ?? written('custom', gate, posting('gate', 3)));
  for (const group of groupTerms(skills.filter((k) => k.requirement === 'must'))) add(skillRow(group, group.some((k) => k.primary), posting('scored', 3)));
  for (const group of groupTerms(skills.filter((k) => k.requirement === 'preferred' || k.requirement === 'nice'))) add(skillRow(group, false, posting('scored', 1)));
  if (brief.role.years_min !== null && !criteria.some((c) => c.kind === 'years')) {
    const family = brief.role.family.trim();
    add(written('years', family ? `${brief.role.years_min}+ years: ${family}` : `${brief.role.years_min}+ years`, posting('scored', 2)));
  }
  const level = levelFromBrief(brief.role.seniority);
  if (level) add(written('level', `${level} (one rung either way)`, posting('scored', 2)));
  if (brief.company.industry) add(written('industry', brief.company.industry, posting('scored', 2)));
  add(written('impact', '', posting('scored', 2)));
  add(written('overall', '', posting('scored', 2)));
  // The person's own criteria survive a redraft.
  for (const c of previous.criteria) if (c.source === 'you') criteria.push(c);
  return RubricSchema.parse({ version: RUBRIC_VERSION, criteria: criteria.slice(0, MAX_CRITERIA), removed: previous.removed });
}

/** The kind a posting's gate sentence names, else a custom yes / no gate. */
function gateKind(gate: string): CriterionKind {
  if (YEARS_WORDS.test(gate) && !CERT_WORDS.test(gate) && !EDUCATION_WORDS.test(gate)) return 'years';
  if (AUTH_WORDS.test(gate)) return 'authorization';
  if (LANGUAGE_WORDS.test(gate)) return 'language';
  if (EDUCATION_WORDS.test(gate)) return 'education';
  if (CERT_WORDS.test(gate)) return 'certification';
  if (LOCATION_WORDS.test(gate)) return 'location';
  if (AVAILABILITY_WORDS.test(gate)) return 'availability';
  return 'custom';
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

/* ---------- presets: one click, then edit ---------- */

export const PRESETS = ['standard', 'junior', 'senior', 'regulated', 'agency'] as const;
export type Preset = (typeof PRESETS)[number];
export const PRESET_LABELS: Record<Preset, string> = {
  standard: 'Standard screen',
  junior: 'Junior hire',
  senior: 'Senior / lead hire',
  regulated: 'Regulated role',
  agency: 'Agency / client work',
};
export const PRESET_HINTS: Record<Preset, string> = {
  standard: 'the draft as the posting reads',
  junior: 'no more than two years as a gate, junior or below, skills at project level or above, impact at one star',
  senior: 'five years or more, senior or above, impact at three stars, a scale criterion to fill in',
  regulated: 'education and certifications as gates',
  agency: 'agency work and the sectors at four stars',
};

/** The draft, bent to a shape of hiring. Pure: the same brief and preset give the same rubric. */
export function applyPreset(rubric: Rubric, preset: Preset): Rubric {
  if (preset === 'standard') return rubric;
  const taken = new Set(rubric.criteria.map((c) => c.id));
  const criteria = rubric.criteria.map((c) => ({ ...c, spec: { ...c.spec } }));
  const has = (kind: CriterionKind) => criteria.find((c) => c.kind === kind);
  const add = (c: Omit<Criterion, 'id'> | null): void => {
    if (!c) return;
    const id = newCriterionId(c.kind, taken);
    taken.add(id);
    criteria.push({ ...c, id });
  };
  const yours = (mode: CriterionMode, weight: number): RowShape => ({ mode, weight, source: 'you' });
  /** The kind's first row rewritten to these words (and `patch`), or a new row when there is none — words and spec change together. */
  const put = (kind: CriterionKind, text: string, fresh: RowShape, patch: Partial<RowShape> = {}): void => {
    const row = written(kind, text, fresh);
    const c = has(kind);
    if (row && c) Object.assign(c, patch, { label: row.label, spec: row.spec });
    else add(row);
  };
  const weigh = (kind: CriterionKind, weight: number): void => {
    const c = has(kind);
    if (c) c.weight = weight;
  };
  switch (preset) {
    case 'junior':
      put('years', '0–2 years', yours('gate', 3), { mode: 'gate' });
      put('level', 'junior or below', yours('scored', 2));
      for (const c of criteria) if (c.kind === 'skill') c.spec.minRung = 'project';
      weigh('impact', 1);
      break;
    case 'senior':
      put('years', `${Math.max(5, has('years')?.spec.min ?? 0)}+ years`, yours('scored', 3));
      put('level', 'senior or above', yours('scored', 3));
      weigh('impact', 3);
      if (!has('scale')) add(written('scale', 'team of 3+ or a system with named numbers', yours('scored', 2)));
      break;
    case 'regulated':
      for (const c of criteria) if (c.kind === 'education' || c.kind === 'certification') c.mode = 'gate';
      if (!has('education')) add(written('education', 'the degree the posting requires', yours('gate', 3)));
      if (!has('certification')) add(written('certification', 'the certification the posting requires', yours('gate', 3)));
      break;
    case 'agency':
      put('companyType', 'agency, consultancy', yours('scored', 4), { weight: 4 });
      weigh('industry', 4);
      break;
  }
  return RubricSchema.parse({ ...rubric, criteria });
}

/* ---------- the editor's grammar: one text field per criterion ---------- */

/** A skill's core mark: "!" as the last token. */
const CORE_MARK = /\s*!\s*$/;
/** A skill's recency window, just before the core mark: "React / Vue within 36 months !". */
const WINDOW_TAIL = /\bwithin\s+(\d+)\s*(months?|years?)$/i;
/** "within" anywhere else in a skill's text is a window the grammar could not read. */
const WINDOW_WORD = /\bwithin\b/i;
/** A years band, the unit optional: "5+", "0–2", "3 to 5 years". */
const YEARS_BAND = /^(\d+)\s*(?:(?:[–-]|to)\s*(\d+)|\+)?\s*(?:years?)?$/i;

/**
 * The "What" text the editor shows for a criterion — what `parseCriterionText`
 * reads back into the same row. A skill's is written from its terms, the
 * window and the core mark in their places; every other kind's is its
 * label, the words it was saved with, and its spec is read from them.
 */
export function criterionText(c: Criterion): string {
  switch (c.kind) {
    case 'skill':
      return skillText(c.spec.terms.map((t) => t.term), c.spec.recentWithinMonths, c.spec.core);
    case 'impact':
    case 'overall':
      return '';
    default:
      return c.label;
  }
}

/** A skill's words: "React / Vue within 36 months !"; without the window it is the row's label. */
function skillText(terms: string[], recentWithinMonths: number | null, core: boolean): string {
  const recency = recentWithinMonths === null ? '' : ` within ${recentWithinMonths} month${recentWithinMonths === 1 ? '' : 's'}`;
  return `${terms.join(' / ')}${recency}${core ? ' !' : ''}`;
}

/** The editor's text back into a spec (the label is the text). Null when the kind needs text and none was given. */
export function parseCriterionText(kind: CriterionKind, raw: string): { label: string; spec: CriterionSpec } | null {
  const text = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
  const list = (s: string): string[] => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  switch (kind) {
    case 'impact':
      return { label: 'outcomes, not duties', spec: SpecSchema.parse({}) };
    case 'overall':
      return { label: 'the whole resume against the whole posting', spec: SpecSchema.parse({}) };
    case 'skill': {
      // The core mark comes off first, then the window before it; "React ! within 36 months" reads the same.
      let core = CORE_MARK.test(text);
      let rest = text.replace(CORE_MARK, '');
      let recentWithinMonths: number | null = null;
      const tail = WINDOW_TAIL.exec(rest);
      if (tail) {
        const months = Number(tail[1]) * (/^y/i.test(tail[2]!) ? MONTHS_PER_YEAR : 1);
        recentWithinMonths = Math.min(MAX_WINDOW_MONTHS, Math.max(MIN_WINDOW_MONTHS, months));
        rest = rest.slice(0, tail.index);
        core ||= CORE_MARK.test(rest);
        rest = rest.replace(CORE_MARK, '');
      }
      // Refused, not kept: inside a term it would be searched for with the term, which then reads as absent for everyone.
      if (WINDOW_WORD.test(rest)) return null;
      const terms = rest.split(' / ').map(termOf).filter(Boolean).slice(0, 12);
      // Longer than the editor's field once written out, it could not come back whole: refused rather than cut.
      if (terms.length === 0 || skillText(terms, recentWithinMonths, core).length > MAX_TEXT) return null;
      return { label: skillText(terms, null, core), spec: SpecSchema.parse({ terms: terms.map((term) => ({ term })), core, recentWithinMonths }) };
    }
    case 'years': {
      // A band with the kind of work after a colon ("5+ years: test automation"), or a sentence that names the years.
      const [head = '', ...work] = text.split(':');
      const band = YEARS_BAND.exec(head.trim());
      const said = band ?? YEARS_WORDS.exec(text);
      if (!said) return null;
      const min = Math.min(MAX_YEARS, Number(said[1]));
      const max = said[2] === undefined ? null : Math.min(MAX_YEARS, Number(said[2]));
      const of = band ? work.join(':').trim() || null : text;
      return { label: text, spec: SpecSchema.parse({ min: max !== null && min > max ? max : min, max, of }) };
    }
    case 'level': {
      const wanted = SCREEN_LEVELS.find((l) => text.toLowerCase().startsWith(l));
      if (!wanted) return null;
      const tolerance: LevelTolerance = /or above|at least|\+$/i.test(text) ? 'atLeast' : /or below|at most|no more/i.test(text) ? 'atMost' : /exact/i.test(text) ? 'exact' : 'one';
      return { label: text, spec: SpecSchema.parse({ wanted, tolerance }) };
    }
    case 'industry': {
      const [sectors, years] = text.split(':');
      const items = list(sectors ?? '');
      if (items.length === 0) return null;
      const min = years ? Number(/\d+/.exec(years)?.[0]) : NaN;
      return { label: text, spec: SpecSchema.parse({ items, min: Number.isNaN(min) ? null : Math.min(MAX_YEARS, min) }) };
    }
    case 'companyType':
    case 'certification': {
      const items = list(text);
      return items.length === 0 ? null : { label: text, spec: SpecSchema.parse({ items }) };
    }
    case 'location': {
      const remoteOk = /\bor remote\b|\bremote ok\b/i.test(text);
      // "Kyiv or remote": the trailing phrase is the flag, not a place; inside a sentence it stays in the sentence.
      const items = list(text.replace(/\s*\b(?:or remote|remote ok)$/i, ''));
      return items.length === 0 && !remoteOk ? null : { label: text, spec: SpecSchema.parse({ items, remoteOk }) };
    }
    case 'education': {
      const [level, fields] = text.split(':');
      if (!text) return null;
      return { label: text, spec: SpecSchema.parse({ level: (level ?? '').trim().slice(0, MAX_TERM) || null, items: fields ? list(fields) : [] }) };
    }
    case 'language':
    case 'authorization':
    case 'availability':
    case 'scale':
      return text ? { label: text, spec: SpecSchema.parse({ level: text.slice(0, MAX_TERM), items: [text] }) } : null;
    case 'custom':
      return text ? { label: text, spec: SpecSchema.parse({ question: text }) } : null;
  }
}

/* ---------- what may not be a criterion ---------- */

/** English words with both edges, Cyrillic stems with a left edge (JS \b is ASCII-only). A stem must not sit inside a job word: "senior", "manager", "startup", "healthcare" all stay. */
const protectedRe = (words: string, stems: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?:${stems})`, 'iu');

const PROTECTED: { re: RegExp; instead: string }[] = [
  { re: protectedRe('age|aged|years? old|young|elderly|birth|born|date of birth', 'вік\\b|дата народження|рік народження|возраст|дата рождения'), instead: 'Say the level or the years instead: "junior or below", "0–2 years".' },
  { re: protectedRe('gender|sex|male|female|man|woman|men|women|girl|boy|lady|guy', 'стать\\b|чоловік|жінк|дівчин|хлоп(?:ець|ці|ця)|мужчин|женщин|парен|девушк'), instead: 'There is no lawful criterion for it — the resume is read blind; if a job requirement is meant, say the requirement.' },
  { re: protectedRe('married|unmarried|divorced|widowed|children|kids|pregnan\\w*|family status|marital', 'одруж|неодруж|заміж|дитин|дітей|діти\\b|вагіт|сімейн|семейн|женат|замужем|дети\\b|беремен'), instead: 'Say the availability or travel requirement as a gate instead: "available for on-call".' },
  { re: protectedRe('nationality|citizen|citizenship|ethnic\\w*|racial|religio\\w*|national origin', 'національн|громадян|релігі|национальн|гражданств|этнич|етніч'), instead: 'Use a work permit criterion ("Work permit: Ukraine") or a language level instead.' },
  { re: protectedRe('disabilit\\w*|disabled|illness|medical condition|sick leave', 'інвалід|хвороб|инвалид|болезн'), instead: 'Say the concrete job requirement as a gate instead: "able to lift 20 kg".' },
];

/** Why a criterion is refused, or null when it may be saved (plan §2.4). */
export function protectedCharacteristic(c: Pick<Criterion, 'kind' | 'label'> & { spec?: Partial<CriterionSpec> }): string | null {
  // The kinds are lawful by construction; only free text can name the person.
  if (c.kind !== 'custom' && c.kind !== 'scale') return null;
  const wording = `${c.label} ${c.spec?.question ?? ''} ${c.spec?.level ?? ''}`;
  for (const p of PROTECTED) {
    if (p.re.test(wording)) return `"${c.label}" names a protected characteristic and cannot be a criterion. ${p.instead}`;
  }
  return null;
}

/* ---------- the form, equality, the summary ---------- */

/**
 * The editor's fields → a rubric: one row per criterion (`text_<id>`,
 * `mode_<id>`, `weight_<id>`, `answer_<id>`, `remove_<id>`) and the add
 * row (`add_kind`, `add_text`, `add_mode`, `add_weight`, `add_answer`).
 * Returns the rubric, or the first problem in words.
 */
export function rubricFromForm(form: Record<string, unknown>, previous: Rubric): { rubric: Rubric } | { error: string } {
  const str = (k: string): string => (typeof form[k] === 'string' ? (form[k] as string) : '');
  const criteria: Criterion[] = [];
  const removed = [...previous.removed];
  const taken = new Set<string>();
  for (const c of previous.criteria) {
    if (str(`remove_${c.id}`) === '1' || str(`remove_${c.id}`) === 'on') {
      if (c.source === 'posting' && !removed.includes(c.label)) removed.push(c.label);
      continue;
    }
    const text = str(`text_${c.id}`);
    const parsed = c.kind === 'impact' || c.kind === 'overall' ? parseCriterionText(c.kind, '') : parseCriterionText(c.kind, text || criterionText(c));
    if (!parsed) return { error: `"${text || c.label}" is not something a ${CRITERION_KIND_LABELS[c.kind].toLowerCase()} criterion can read — ${CRITERION_KIND_HINTS[c.kind]}.` };
    const mode = (CRITERION_MODES as readonly string[]).includes(str(`mode_${c.id}`)) ? (str(`mode_${c.id}`) as CriterionMode) : c.mode;
    const weight = Math.max(1, Math.min(MAX_WEIGHT, Math.round(Number(str(`weight_${c.id}`)) || c.weight)));
    const answer = str(`answer_${c.id}`) === 'howmuch' ? 'howmuch' : str(`answer_${c.id}`) === 'yesno' ? 'yesno' : c.spec.answer;
    // A skill keeps each unchanged term's aliases and its minimum rung; the text sets the terms, the core mark and the window.
    const spec = c.kind === 'skill' ? { ...parsed.spec, terms: keepAliases(parsed.spec.terms, c.spec.terms), minRung: c.spec.minRung } : { ...parsed.spec, answer };
    const next: Criterion = { ...c, label: parsed.label, mode, weight, spec: SpecSchema.parse(spec) };
    const refused = protectedCharacteristic(next);
    if (refused) return { error: refused };
    taken.add(c.id);
    criteria.push(next);
  }
  const addKind = str('add_kind');
  const addText = str('add_text').trim();
  if ((CRITERION_KINDS as readonly string[]).includes(addKind) && (addText || addKind === 'impact' || addKind === 'overall')) {
    const kind = addKind as CriterionKind;
    const parsed = parseCriterionText(kind, addText);
    if (!parsed) return { error: `"${addText}" is not something a ${CRITERION_KIND_LABELS[kind].toLowerCase()} criterion can read — ${CRITERION_KIND_HINTS[kind]}.` };
    const mode = (CRITERION_MODES as readonly string[]).includes(str('add_mode')) ? (str('add_mode') as CriterionMode) : 'scored';
    const weight = Math.max(1, Math.min(MAX_WEIGHT, Math.round(Number(str('add_weight')) || 3)));
    const answer = str('add_answer') === 'howmuch' ? 'howmuch' : 'yesno';
    const next: Criterion = { id: newCriterionId(kind, taken), kind, label: parsed.label, mode, weight, source: 'you', spec: SpecSchema.parse({ ...parsed.spec, answer }) };
    const refused = protectedCharacteristic(next);
    if (refused) return { error: refused };
    if (criteria.filter((c) => c.kind === 'custom').length >= MAX_CUSTOM && kind === 'custom') return { error: `At most ${MAX_CUSTOM} criteria in your own words.` };
    criteria.push(next);
  }
  if (criteria.length > MAX_CRITERIA) return { error: `At most ${MAX_CRITERIA} criteria.` };
  return { rubric: RubricSchema.parse({ version: RUBRIC_VERSION, criteria, removed: removed.slice(-MAX_REMOVED) }) };
}

/** A status or years row's spec fields read out of its own words; nothing reads them, the model reads the words. */
const WORD_READINGS = new Set(['items', 'level', 'remoteOk', 'question', 'of']);

/**
 * Same yardstick or not — what decides whether a save bumps the version. Ids
 * and sources do not count; what is read and weighed does: the words, the
 * mode, a scored row's stars, and the spec the score reads. A status or
 * years row's reading of its own words is left out, so an older reading of
 * the same words (a draft from before the grammar wrote every row) is the
 * same yardstick.
 */
export function rubricEquals(a: Rubric, b: Rubric): boolean {
  const weighed = (c: Criterion) => (KIND_ANSWER[c.kind] === 'status' || c.kind === 'years' ? Object.entries(c.spec).filter(([field]) => !WORD_READINGS.has(field)) : c.spec);
  const key = (r: Rubric) => JSON.stringify(r.criteria.map((c) => [c.kind, c.label.toLowerCase(), c.mode, c.mode === 'scored' ? c.weight : 0, weighed(c)]));
  return key(a) === key(b);
}

/** "5 gates · 9 scored · 2 notes · 3 in your own words" */
export function rubricSummary(r: Rubric): string {
  const gates = r.criteria.filter((c) => c.mode === 'gate').length;
  const scored = r.criteria.filter((c) => c.mode === 'scored').length;
  const notes = r.criteria.filter((c) => c.mode === 'note').length;
  const yours = r.criteria.filter((c) => c.source === 'you').length;
  const parts = [`${gates} gate${gates === 1 ? '' : 's'}`, `${scored} scored`];
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? '' : 's'}`);
  if (yours > 0) parts.push(`${yours} in your own words`);
  return parts.join(' · ');
}

/** The skill criteria whose terms count as the core stack — the cap's question (score.ts). */
export function coreCriteria(r: Rubric): Criterion[] {
  return r.criteria.filter((c) => c.kind === 'skill' && c.spec.core);
}
