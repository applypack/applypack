import type { FactLike } from './facts';
import { canonicalTerm } from './facts';

/*
 * Deterministic fact gate (ADR 0020). Generated prose in, verdict out — no
 * AI, no I/O, no Prisma: sources arrive as arguments, store.ts loads them.
 *
 * It is a FABRICATION detector, not a precision auditor. Every ambiguous
 * case resolves toward not blocking: a gate that fires on truthful text
 * teaches the user to click through it, and then it protects nothing.
 *
 * Pure: tested in fact-check.test.ts.
 */

export type FactVerdict = 'pass' | 'warn' | 'block';
export type ClaimKind = 'metric' | 'employer' | 'title' | 'tool';
export type ClaimStatus = 'supported' | 'unsupported' | 'allowed';
/** How a value is qualified. `bare` cross-matches any class of the same value. */
export type UnitClass = 'pct' | 'money' | 'count' | 'magnitude' | 'bare';

export interface FactClaim {
  kind: ClaimKind;
  /** The span as written in the checked text. */
  text: string;
  /** Matching key — both sides of the check are canonicalized identically. */
  canonical: string;
  status: ClaimStatus;
  /** Where support came from, when there is any. */
  from?: 'source' | 'fact' | 'allowlist';
}

export interface FactCheckInput {
  /** The generated text under test. */
  text: string;
  /** Grounded text: resume, match summary, stored verification evidence. */
  sources: string[];
  /** CandidateFact rows — confirmed terms support, denied terms contradict. */
  facts?: FactLike[];
  /** The company being written to: naming it is not a claim about the past. */
  addressee?: string | null;
  allowMetrics?: string[];
  allowFacts?: string[];
}

export interface FactCheckResult {
  verdict: FactVerdict;
  claims: FactClaim[];
  /** Count-shaped spans the extractor could not read (never a silent pass). */
  unchecked: number;
  /** Allowlist entries that canonicalize to nothing, and so protect nothing. */
  inertAllowlist: string[];
  /** One line per problem, quotable straight into a regeneration prompt. */
  reasons: string[];
}

/** Role nouns that make an "as a …" span a claim about the writer's history. */
export const TITLE_NOUNS = [
  'engineer', 'developer', 'architect', 'lead', 'manager', 'designer',
  'analyst', 'scientist', 'director', 'consultant', 'administrator',
  'specialist', 'programmer', 'devops', 'sre',
] as const;

/**
 * Capitalized words that follow a history trigger without naming an employer.
 * `with` is deliberately not a trigger: "built with PHP" is a tool statement,
 * and tool claims are bounded to the CandidateFact vocabulary (ADR 0020).
 */
const NOT_AN_EMPLOYER = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'present', 'today',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'i', 'the', 'a', 'an', 'this', 'that', 'your', 'my', 'our', 'it', 'we',
  'scale', 'least', 'most', 'work', 'home', 'first', 'all',
]);

const EMPLOYER_TRIGGER = /\b(?:at|for|joined|left)\s+((?:[A-Z][\w&'.-]*)(?:\s+(?:[A-Z][\w&'.-]*|of|and|&)){0,3})/g;
const TITLE_TRIGGER = /\bas\s+an?\s+((?:[A-Za-z][\w-]*)(?:[\s/]+[A-Za-z][\w-]*){0,4})/g;

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
const MAGNITUDES: Record<string, number> = {
  hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
  k: 1_000, m: 1_000_000, b: 1_000_000_000,
};
/** Plural magnitude words carry a claim with no resolvable number of its own. */
const VAGUE_MAGNITUDES = ['hundreds', 'thousands', 'millions', 'billions'];

/** A sentence this far into another script cannot be read for count nouns. */
const NON_LATIN_SHARE = 0.3;

// ---------------------------------------------------------------- normalize

/**
 * One pipeline, applied identically to both sides. NFKC alone is not enough:
 * measured on our own resumes, it leaves `–`, `—` and `’` untouched — the
 * only non-ASCII characters they actually contain (ADR 0020).
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/[‘’‛ʼ´`]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[•∙·●▪]/g, ' ; ')
    .replace(/[^\S\n]+/g, ' ');
}

/** Contact data is not evidence — strip it before any number is parsed. */
function maskContacts(s: string): string {
  return s
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/g, ' ')
    .replace(/\b[\w-]+\.(?:com|net|org|io|dev|co)\b\S*/g, ' ')
    .replace(/\+?\d{0,3}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, ' ');
}

/**
 * Tokens whose digits identify a thing, not a quantity: big-O, `v1.5`,
 * letter-glued forms (`EC2`, `HTML5`, `p95`) and anything year-shaped.
 * Masking every year costs us the rare four-digit count ("2000 users");
 * leaving them in costs a false block on every letter saying "since 2021".
 * A spaced version (`PHP 7`) is not masked — it survives as a bare number
 * and bare numbers do not block.
 */
function maskNonQuantities(s: string): string {
  return s
    .replace(/\bO\([^)]*\)/g, ' ')
    .replace(/\bv\d+(?:\.\d+)*\b/gi, ' ')
    .replace(/\b[A-Za-z]+\d[\w.*]*/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ');
}

/** Block boundaries, so two bullets never glue into one phantom claim. */
function segments(s: string): string[] {
  return s
    .split(/\n+|(?<=[.;!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function nonLatinDominant(seg: string): boolean {
  const letters = seg.match(/\p{L}/gu);
  if (!letters || letters.length < 8) return false;
  const latin = seg.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return (letters.length - latin) / letters.length >= NON_LATIN_SHARE;
}

// ------------------------------------------------------------------ numbers

/**
 * Thousands separators only when the token is fully group-structured. Measured
 * why: the one separator-shaped match in our corpus is `267 554`, a fragment
 * of a phone number (ADR 0020).
 */
function parseNumber(token: string): number | null {
  const t = token.replace(/\+$/, '');
  if (/^\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?$/.test(t)) return Number(t.replace(/[,\s]/g, ''));
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return null;
}

function keyOf(unit: UnitClass, value: number | string): string {
  return `${unit}:${value}`;
}

interface RawClaim {
  unit: UnitClass;
  value: number | string;
  text: string;
}

const NUM = String.raw`\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
// "one" is an article's cousin far more often than a quantity ("split one
// database", "one of the teams"), and claiming it asserts nothing anyway.
const WORD_NUM = Object.keys(SMALL_NUMBERS).filter((w) => w !== 'one').join('|');
const MAG = `hundred|thousand|million|billion|k|m|b`;
/** Function words after a number do not make it a count of anything. */
const NOT_A_NOUN = `and|or|to|of|the|an|in|on|at|for|with|by|from|as|is|are|was|were|but|that|this|it|its|per|than|into|out|up|down|over|under`;

/**
 * Ordered most-specific first; each match is blanked out of the segment so a
 * looser pattern cannot claim the same span twice (`15-20%` is a range, not
 * a bare 15 followed by a percent).
 */
const PATTERNS: Array<{ unit: UnitClass; re: RegExp; values: (m: RegExpExecArray) => Array<number | string> }> = [
  {
    unit: 'pct',
    re: new RegExp(String.raw`(${NUM})\s*-\s*(${NUM})\s*%`, 'gi'),
    values: (m) => [scale(m[1]), scale(m[2])].filter(isValue),
  },
  {
    unit: 'money',
    re: new RegExp(String.raw`[$€£]\s?(${NUM})\+?\s?(${MAG})?\b`, 'gi'),
    values: (m) => [scale(m[1], m[2])].filter(isValue),
  },
  {
    unit: 'pct',
    re: new RegExp(String.raw`\b(${NUM}|${WORD_NUM})\+?\s?(?:%|percent\b)`, 'gi'),
    values: (m) => [scale(m[1])].filter(isValue),
  },
  // A vague magnitude carries no number of its own, so it matches only the
  // same phrase — a letter cannot sharpen "hundreds of thousands" into a figure.
  {
    unit: 'magnitude',
    re: new RegExp(String.raw`\b(${VAGUE_MAGNITUDES.join('|')})(?:\s+of\s+(${VAGUE_MAGNITUDES.join('|')}))?\b`, 'gi'),
    values: (m) => [[m[1], m[2]].filter(Boolean).join('-of-').toLowerCase()],
  },
  {
    unit: 'count',
    re: new RegExp(String.raw`\b(${NUM}|${WORD_NUM})\+?\s?(${MAG})?\s+(?!(?:${NOT_A_NOUN})\b)[a-z][a-z-]+`, 'gi'),
    values: (m) => [scale(m[1], m[2])].filter(isValue),
  },
  {
    unit: 'bare',
    re: new RegExp(String.raw`\b(${NUM}|${WORD_NUM})\+?\s?(${MAG})?\b`, 'gi'),
    values: (m) => [scale(m[1], m[2])].filter(isValue),
  },
];

/** Units that survive outside Latin script — `%` and `$` need no vocabulary. */
const SCRIPT_AGNOSTIC: UnitClass[] = ['pct', 'money'];

function isValue<T>(v: T | null): v is T {
  return v !== null;
}

/** A numeric token, spelled-out numeral, or either scaled by a magnitude. */
function scale(token: string | undefined, magnitude?: string): number | null {
  if (!token) return null;
  const t = token.replace(/\+$/, '');
  const base = /^[\d,.\s]+$/.test(t)
    ? (/^\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?$/.test(t)
      ? Number(t.replace(/[,\s]/g, ''))
      : (/^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null))
    : (SMALL_NUMBERS[t.toLowerCase()] ?? null);
  if (base === null) return null;
  const mag = magnitude ? MAGNITUDES[magnitude.toLowerCase()] : undefined;
  return mag ? base * mag : base;
}

/** Extract claims segment by segment; report spans we could not read. */
function extractMetrics(normalized: string): { claims: RawClaim[]; unchecked: number } {
  const claims: RawClaim[] = [];
  let unchecked = 0;
  for (const seg of segments(maskNonQuantities(maskContacts(normalized)))) {
    const blind = nonLatinDominant(seg);
    const chars = [...seg];
    for (const { unit, re, values } of PATTERNS) {
      // A count noun we cannot read must surface as unchecked, never as clean.
      if (blind && !SCRIPT_AGNOSTIC.includes(unit)) continue;
      for (const m of chars.join('').matchAll(re)) {
        const vals = values(m as RegExpExecArray);
        if (vals.length === 0) continue;
        for (const value of vals) claims.push({ unit, value, text: m[0].trim() });
        chars.fill(' ', m.index, m.index + m[0].length);
      }
    }
    if (blind) unchecked += (chars.join('').match(/\d+/g) ?? []).length;
  }
  return { claims, unchecked };
}

// --------------------------------------------------------------- assertions

interface RawAssertion {
  kind: 'employer' | 'title';
  text: string;
  canonical: string;
}

/**
 * Only claims about the writer's own history. Naming the company being
 * written to is not one — measured on a real letter of ours, the addressee
 * appears in the second person ("your mission"), never under these triggers.
 */
/** A captured run keeps neither trailing punctuation nor a dangling connector. */
function trimRun(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/(?:[.,;:'-]+|\s+(?:of|and|&))+$/i, '');
}

function extractAssertions(normalized: string, addressee: string | null): RawAssertion[] {
  const out: RawAssertion[] = [];
  const skip = new Set(NOT_AN_EMPLOYER);
  if (addressee) for (const w of addressee.toLowerCase().split(/\s+/)) skip.add(w);
  const addresseeKey = addressee ? canonicalTerm(addressee) : null;

  for (const m of normalized.matchAll(EMPLOYER_TRIGGER)) {
    const name = trimRun(m[1]);
    const key = canonicalTerm(name);
    if (!key || key === addresseeKey) continue;
    if (key.split(/\s+/).every((w) => skip.has(w))) continue;
    out.push({ kind: 'employer', text: name, canonical: key });
  }
  for (const m of normalized.matchAll(TITLE_TRIGGER)) {
    const role = trimRun(m[1]);
    const key = canonicalTerm(role);
    if (!TITLE_NOUNS.some((n) => key.split(/[\s/]+/).includes(n))) continue;
    out.push({ kind: 'title', text: role, canonical: key });
  }
  return out;
}

// ----------------------------------------------------------------- matching

/** Source values by number, so a bare source figure supports any unit class. */
function indexSources(sources: string[]): { keys: Set<string>; values: Set<string> } {
  const keys = new Set<string>();
  const values = new Set<string>();
  for (const raw of sources) {
    for (const c of extractMetrics(normalizeText(raw)).claims) {
      keys.add(keyOf(c.unit, c.value));
      if (c.unit !== 'magnitude') values.add(String(c.value));
    }
  }
  return { keys, values };
}

/**
 * Supported when the same value is present under the same unit, or when one
 * of the two sides carries no unit at all — unit drift is a phrasing choice,
 * inventing the number is not (ADR 0020).
 */
function metricSupported(claim: RawClaim, src: { keys: Set<string>; values: Set<string> }): boolean {
  if (src.keys.has(keyOf(claim.unit, claim.value))) return true;
  if (claim.unit === 'magnitude') return false;
  if (claim.unit === 'bare') return src.values.has(String(claim.value));
  return src.keys.has(keyOf('bare', claim.value));
}

/**
 * Run an allowlist entry through the same extractor, so an entry that can
 * never match is detectable instead of silently inert — the bug class this
 * gate exists to catch. Returns null when the entry yields no claim at all.
 */
export function canonicalizeAllowEntry(entry: string): string | null {
  const first = extractMetrics(normalizeText(entry)).claims[0];
  if (first) return keyOf(first.unit, first.value);
  const term = canonicalTerm(normalizeText(entry));
  return term.length > 0 ? term : null;
}

/** Whole-word containment on two strings already put through the pipeline. */
function mentions(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${escaped}(?![\p{L}\p{N}])`, 'u').test(haystack);
}

// ------------------------------------------------------------------ verdict

/**
 * Check generated prose against the sources it is supposed to be grounded in.
 * Sources arrive already loaded — this module never touches Prisma.
 */
export function factCheck(input: FactCheckInput): FactCheckResult {
  const normalized = normalizeText(input.text);
  const src = indexSources(input.sources);
  // Allowed metrics are indexed exactly like sources, so an entry written in
  // another surface form still matches the claim it was meant to cover.
  const allowedMetrics = indexSources(input.allowMetrics ?? []);
  const allowedFacts = new Set(
    (input.allowFacts ?? []).map(canonicalizeAllowEntry).filter((k): k is string => k !== null),
  );
  const inertAllowlist = [...(input.allowMetrics ?? []), ...(input.allowFacts ?? [])]
    .filter((e) => canonicalizeAllowEntry(e) === null);
  const sourceText = canonicalTerm(normalizeText(input.sources.join('\n')));

  const claims: FactClaim[] = [];
  const reasons: string[] = [];
  const seen = new Set<string>();
  const add = (c: FactClaim, reason?: string) => {
    const dedupe = `${c.kind}|${c.canonical}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    claims.push(c);
    if (c.status === 'unsupported') {
      reasons.push(reason ?? `${c.kind} "${c.text}" is not in the resume or confirmed facts`);
    }
  };

  // A unitless number asserts almost nothing ("PHP 7", "one of 3 teams") but
  // would false-block constantly, so on the generated side it is not a claim.
  // Sources still index theirs, where they widen support (ADR 0020).
  const { claims: metrics, unchecked } = extractMetrics(normalized);
  for (const m of metrics.filter((c) => c.unit !== 'bare')) {
    const canonical = keyOf(m.unit, m.value);
    if (metricSupported(m, src)) add({ kind: 'metric', text: m.text, canonical, status: 'supported', from: 'source' });
    else if (metricSupported(m, allowedMetrics)) add({ kind: 'metric', text: m.text, canonical, status: 'allowed', from: 'allowlist' });
    else add({ kind: 'metric', text: m.text, canonical, status: 'unsupported' });
  }

  for (const a of extractAssertions(normalized, input.addressee ?? null)) {
    if (mentions(sourceText, a.canonical)) add({ ...a, status: 'supported', from: 'source' });
    else if (allowedFacts.has(a.canonical)) add({ ...a, status: 'allowed', from: 'allowlist' });
    else add({ ...a, status: 'unsupported' });
  }

  // Facts are the only support for a tool claim, and the only contradiction:
  // a denied term is the user saying outright they cannot claim it. Resume
  // text still outranks a stale denial, exactly as facts.ts:applyFacts does.
  const body = canonicalTerm(normalized);
  for (const f of input.facts ?? []) {
    const term = canonicalTerm(f.term);
    if (!mentions(body, term)) continue;
    if (f.status === 'confirmed') {
      add({ kind: 'tool', text: f.term, canonical: term, status: 'supported', from: 'fact' });
    } else if (f.status === 'denied' && !mentions(sourceText, term) && !allowedFacts.has(term)) {
      add({ kind: 'tool', text: f.term, canonical: term, status: 'unsupported' },
        `tool "${f.term}" is marked as one you cannot claim`);
    }
  }

  if (unchecked > 0) reasons.push(`${unchecked} claim${unchecked === 1 ? '' : 's'} could not be checked`);
  for (const e of inertAllowlist) reasons.push(`allowlist entry "${e}" can never match anything`);

  const verdict: FactVerdict = claims.some((c) => c.status === 'unsupported')
    ? 'block'
    : unchecked > 0
      ? 'warn'
      : 'pass';
  return { verdict, claims, unchecked, inertAllowlist, reasons };
}
