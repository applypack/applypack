import type { FactLike } from './facts';
import { canonicalTerm } from './facts';
import { joinWrapped } from './structure-from-text';

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
  /**
   * The resume the text speaks for. Given, every figure must also stay with the
   * work its own line names (`detachedFigures`, #632) — a true number told
   * about other work warns.
   */
  resume?: string;
  /** For a rewrite: the resume text it takes the place of. */
  replacing?: string | null;
}

export interface FactCheckResult {
  verdict: FactVerdict;
  claims: FactClaim[];
  /** Count-shaped spans the extractor could not read (never a silent pass). */
  unchecked: number;
  /** Allowlist entries that canonicalize to nothing, and so protect nothing. */
  inertAllowlist: string[];
  /** True figures told about work their own lines do not name; empty without `resume`. */
  detached: DetachedFigure[];
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

// The trigger's own case is spelled out rather than set with the /i flag: /i
// would also relax `[A-Z]`, and then every lowercase word after "at" reads as
// a company. A letter opening "At Vodwork I led …" still has to be caught.
const EMPLOYER_TRIGGER = /\b(?:[Aa]t|[Ff]or|[Jj]oined|[Ll]eft)\s+((?:[A-Z][\w&'.-]*)(?:\s+(?:[A-Z][\w&'.-]*|of|and|&)){0,3})/g;
const TITLE_TRIGGER = /\b[Aa]s\s+an?\s+((?:[A-Za-z][\w-]*)(?:[\s/]+[A-Za-z][\w-]*){0,4})/g;

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
  if (/^\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?$/.test(token)) return Number(token.replace(/[,\s]/g, ''));
  if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
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
  const base = parseNumber(t) ?? SMALL_NUMBERS[t.toLowerCase()] ?? null;
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
 * A captured run keeps no trailing punctuation, connector, or one-letter word:
 * "At OGD Solutions I processed …" is a claim about OGD Solutions, not about
 * "OGD Solutions I".
 */
function trimRun(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/(?:[.,;:'-]+|\s+(?:of|and|&|[A-Za-z]))+$/i, '');
}

/**
 * Pronoun contractions ride into the capture because they start uppercase:
 * "At V Shred I've built …" is a claim about V Shred, not "V Shred I've".
 * Caught live by the first F8 letter — the fix tightens the extractor, never
 * the verdict (ADR 0020).
 */
function dropTrailingNonNames(name: string): string {
  const words = name.split(/\s+/);
  while (words.length > 0) {
    const last = words[words.length - 1]!.toLowerCase().replace(/'\w+$/, '');
    if (!NOT_AN_EMPLOYER.has(last)) break;
    words.pop();
  }
  return words.join(' ');
}

/**
 * Only claims about the writer's own history. Naming the company being
 * written to is not one — measured on a real letter of ours, the addressee
 * appears in the second person ("your mission"), never under these triggers.
 */
function extractAssertions(normalized: string, addressee: string | null): RawAssertion[] {
  const out: RawAssertion[] = [];
  const skip = new Set(NOT_AN_EMPLOYER);
  if (addressee) for (const w of addressee.toLowerCase().split(/\s+/)) skip.add(w);
  const addresseeKey = addressee ? canonicalTerm(addressee) : null;

  for (const m of normalized.matchAll(EMPLOYER_TRIGGER)) {
    // The name class allows '.' (Node.js Inc.), so a run can glue across a
    // sentence boundary: "at OGD Solutions. AI-first…" → "OGD Solutions. AI".
    // Cut at dot-space — the same fix gotcha 6 needed in the HN parser.
    const name = dropTrailingNonNames(trimRun(m[1]!.split(/\.\s/)[0]));
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

// --------------------------------------------------------------- attachment

/*
 * A figure is a claim about the work its own line names (#632). The value
 * check above proves "35 minutes" is in the resume; it cannot see that a
 * rewrite moved it from "set up structured logging and alerting" onto "ran
 * on-call rotations", which the resume says nothing of — a true number told
 * about other work. So each figure is read with the words around it:
 *
 *  - in a rewrite of one bullet, a figure the bullet did not carry is
 *    another bullet's, and it stays out unless the two lines describe the same
 *    work (they share a word that names it);
 *  - anywhere else (a summary, a new line, a letter), the words that say WHAT
 *    produced the figure — the piece of the sentence before it ("ran on-call
 *    rotations | that cut …"), and what follows it ("… by introducing the
 *    runbooks") — may not come from another bullet while naming nothing of the
 *    figure's own line or its role.
 *
 * Only distinctive words count: verbs, title nouns and words every bullet
 * uses ("built", "team", "services") say nothing about which work it was, and
 * a word the resume never uses is a paraphrase, not a borrowing. A bullet is a
 * line that opens with a bullet marker; a resume without them is not read, and
 * nothing is flagged — the bias toward not blocking (ADR 0020) holds here too.
 */

export interface DetachedFigure {
  /** The figure as the checked text writes it. */
  figure: string;
  /** The other work it was put on, in the checked text's words, or the line it came from. */
  onto: string;
  /** The resume line the figure belongs to. */
  line: string;
  reason: string;
}

/** A line that opens with a bullet marker is one piece of work. */
const BULLET_LINE = /^\s*[-•*·‣▪●◦∙–]\s+/;
/** The non-bullet lines above a run of bullets that name its role: company, title, dates. */
const ROLE_LINES = 3;
/** How much of the figure's own line a reason quotes. */
const LINE_QUOTE = 90;

/** Words that say nothing about which work a sentence is about. */
const PLAIN_WORDS = new Set([
  // function words
  'the', 'and', 'but', 'nor', 'for', 'with', 'from', 'into', 'onto', 'over', 'under', 'out', 'off', 'about',
  'after', 'before', 'during', 'through', 'across', 'between', 'within', 'without', 'per', 'via', 'than',
  'then', 'that', 'this', 'these', 'those', 'its', 'their', 'our', 'your', 'his', 'her', 'who', 'whom',
  'whose', 'which', 'where', 'when', 'while', 'what', 'how', 'also', 'just', 'only', 'very', 'more', 'most',
  'less', 'least', 'much', 'many', 'each', 'every', 'all', 'any', 'some', 'both', 'other', 'such', 'own',
  'same', 'new', 'now', 'still', 'already', 'well', 'even', 'again', 'once', 'there', 'here', 'they', 'them',
  'you', 'was', 'were', 'are', 'been', 'being', 'has', 'have', 'had', 'having', 'did', 'does', 'doing',
  'can', 'could', 'would', 'should', 'will', 'may', 'might', 'must', 'not', 'one', 'two', 'three', 'four',
  'five', 'six', 'seven', 'eight', 'nine', 'ten', 'end', 'way', 'along', 'around', 'against', 'toward',
  'towards', 'upon', 'since', 'until', 'because', 'whether', 'like',
  // what every bullet says, whatever the work was
  'build', 'built', 'building', 'lead', 'led', 'leading', 'run', 'ran', 'running', 'make', 'made', 'making',
  'work', 'worked', 'working', 'use', 'used', 'using', 'write', 'wrote', 'written', 'writing', 'create',
  'created', 'creating', 'develop', 'developed', 'developing', 'design', 'designed', 'designing', 'deliver',
  'delivered', 'delivering', 'improve', 'improved', 'improving', 'reduce', 'reduced', 'reducing', 'cut',
  'cutting', 'increase', 'increased', 'increasing', 'owned', 'owning', 'ship', 'shipped', 'shipping',
  'launch', 'launched', 'launching', 'manage', 'managed', 'managing', 'handle', 'handled', 'handling',
  'help', 'helped', 'helping', 'set', 'setting', 'add', 'added', 'adding', 'move', 'moved', 'moving',
  'keep', 'kept', 'keeping', 'drive', 'drove', 'driving', 'implement', 'implemented', 'implementing',
  'maintain', 'maintained', 'maintaining', 'support', 'supported', 'supporting', 'enable', 'enabled',
  'enabling', 'achieve', 'achieved', 'bring', 'brought', 'take', 'took', 'serve', 'served', 'serving',
  'fell', 'fall', 'drop', 'dropped', 'grow', 'grew', 'growing', 'lower', 'lowered', 'raise', 'raised',
  'get', 'got', 'give', 'gave', 'deploy', 'deployed', 'deploying', 'ensure', 'ensured', 'provide',
  'provided', 'providing', 'production', 'team', 'experience', 'year', 'product', 'project', 'service',
  'system', 'application', 'app', 'platform', 'feature', 'code', 'software', 'solution', 'company',
  'business', 'role', 'result', 'impact', 'time', 'day', 'week', 'month', 'hour', 'minute', 'second',
  'customer', 'client', 'user', 'people', 'staff', 'request', 'line', 'number', 'stack', 'end-to-end',
  'daily', 'weekly', 'monthly', 'yearly', 'annually', 'total', 'overall',
  ...TITLE_NOUNS,
]);

/** One plural folded, so "schemas" and "schema" are one word on both sides. */
function fold(word: string): string {
  if (/[.+#]/.test(word)) return word;
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** The distinctive words of a span, folded, each with the first spelling the span used. */
export function workWords(span: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of span.split(/[\s,;:()[\]{}"'!?/|]+/)) {
    const surface = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu, '');
    const lower = surface.toLowerCase();
    if ((lower.match(/\p{L}/gu)?.length ?? 0) < 3) continue;
    const word = fold(lower);
    if (PLAIN_WORDS.has(word) || PLAIN_WORDS.has(lower)) continue;
    if (!out.has(word)) out.set(word, surface);
  }
  return out;
}

interface WorkItem {
  line: string;
  /** A bullet is one piece of work; a prose line (a summary) only owns the figures it states. */
  bullet: boolean;
  words: Set<string>;
  /** Its role's lines: the company and the title belong to every bullet under them. */
  role: Set<string>;
  /** Every value the line states, unit aside. */
  values: Set<string>;
}

function valuesOf(text: string): Set<string> {
  return new Set(
    extractMetrics(normalizeText(text)).claims.filter((c) => c.unit !== 'magnitude').map((c) => String(c.value)),
  );
}

/**
 * The resume's bullets, each with its role's lines, and the prose lines that
 * state a figure; a wrapped PDF bullet is one line again.
 */
function workItems(resume: string): WorkItem[] {
  const items: WorkItem[] = [];
  let heads: string[] = [];
  let role = new Set<string>();
  let inBullets = false;
  for (const line of joinWrapped(resume.replace(/\r\n/g, '\n').split('\n'))) {
    if (!BULLET_LINE.test(line)) {
      // A section heading ends what came before it: the skills line is no role's.
      if (inBullets || line.startsWith('#')) heads = [];
      inBullets = false;
      if (line.startsWith('#')) continue;
      heads.push(line);
      const values = valuesOf(line);
      if (values.size > 0) items.push({ line, bullet: false, words: new Set(workWords(line).keys()), role: new Set(), values });
      continue;
    }
    if (!inBullets) role = new Set(workWords(heads.slice(-ROLE_LINES).join(' ')).keys());
    inBullets = true;
    const text = line.replace(BULLET_LINE, '');
    items.push({ line: text, bullet: true, words: new Set(workWords(text).keys()), role, values: valuesOf(text) });
  }
  return items;
}

/** The same words with no attention to case, spacing or punctuation. */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Where a sentence hands over from one statement to the next. A relative word
 * or a participle opens a piece that says what the piece before it did ("ran
 * on-call rotations | that cut …", "…systems | serving 1.8M requests"); a
 * comma or an "and" opens a statement of its own.
 */
const HANDOVER =
  /\s*(?:(,(?=\s)|[:()—–]|\s-\s|\b(?:and|so)\b)|\b(?:that|which|where|who|whose|while|when|thereby)\b)\s*|(?<=\s)(?=\p{L}{2,}ing\b)/giu;
/** After a figure, the words that say how it was reached: "… to 35 minutes | by introducing the runbooks". */
const MEANS = /^\s*(?:by|through|via|using|with|after)\b/i;
const PARTICIPLE = /^\p{L}+ing\b/u;

interface Piece {
  text: string;
  /** Opened by a relative word or a participle: it is what the piece before it did. */
  dependent: boolean;
}

function pieces(sentence: string): Piece[] {
  const out: Piece[] = [];
  let from = 0;
  let dependent = false;
  const push = (end: number) => {
    const text = sentence.slice(from, end).trim();
    if (text !== '') out.push({ text, dependent });
  };
  for (const m of sentence.matchAll(HANDOVER)) {
    push(m.index);
    dependent = m[1] === undefined;
    from = m.index + m[0].length;
  }
  push(sentence.length);
  return out;
}

function quoteLine(line: string): string {
  return line.length > LINE_QUOTE ? `${line.slice(0, LINE_QUOTE).trimEnd()}…` : line;
}

/**
 * The figures of `text` told about work their own lines do not name. `replacing`
 * is the resume text a rewrite takes the place of: the figures it carried are
 * that line's own.
 */
export function detachedFigures(text: string, resume: string, replacing?: string | null): DetachedFigure[] {
  const items = workItems(resume);
  const bullets = items.filter((i) => i.bullet);
  if (bullets.length === 0) return [];
  const replaced = replacing ? squash(replacing.replace(BULLET_LINE, '')) : '';
  // The bullet a rewrite replaces, when it replaces (part of) one and only one.
  const holding = replaced === '' ? [] : bullets.filter((i) => squash(i.line).includes(replaced));
  const own = holding.length === 1 ? holding[0] : undefined;
  const kept = replacing ? valuesOf(replacing) : new Set<string>();
  const out: DetachedFigure[] = [];

  for (const sentence of segments(normalizeText(text))) {
    const parts = pieces(sentence);
    for (const claim of extractMetrics(sentence).claims) {
      if (claim.unit === 'bare' || claim.unit === 'magnitude') continue;
      const value = String(claim.value);
      if (kept.has(value) || out.some((d) => d.figure === claim.text)) continue;
      const lines = items.filter((i) => i.values.has(value));
      if (lines.length === 0 || (own && lines.includes(own))) continue;
      const onto = own ? ontoOtherBullet(own, lines) : ontoOtherWork(parts, claim.text, lines, bullets);
      if (onto === null) continue;
      // Of the lines that state this value, the one the sentence reads most like.
      const said = workWords(sentence);
      const overlap = (i: WorkItem) => [...i.words].filter((w) => said.has(w)).length;
      const line = lines.reduce((best, i) => (overlap(i) > overlap(best) ? i : best)).line;
      out.push({
        figure: claim.text,
        onto,
        line,
        reason: `figure "${claim.text}" is told about ${onto}, but the resume gives it to "${quoteLine(line)}" — keep a figure with the work its own line names`,
      });
    }
  }
  return out;
}

/** A bullet's figure brought into another bullet: the two lines must name one piece of work. */
function ontoOtherBullet(own: WorkItem, lines: WorkItem[]): string | null {
  const shared = [...own.words].some((w) => lines.some((i) => i.words.has(w)));
  return shared ? null : `"${quoteLine(own.line)}"`;
}

/**
 * The words that say what produced the figure, borrowed from other bullets
 * while naming nothing of the figure's own line or role. Those words are the
 * piece the figure's piece depends on ("ran on-call rotations | that cut …"),
 * and the means after it ("… by introducing the runbooks"); a statement with
 * neither says it in its own words before the figure. A participle that states
 * a figure of its own is that figure's result, not this one's means.
 */
function ontoOtherWork(parts: Piece[], figure: string, lines: WorkItem[], bullets: WorkItem[]): string | null {
  const at = parts.findIndex((p) => p.text.includes(figure));
  if (at < 0) return null;
  const piece = parts[at]!;
  const before = piece.text.slice(0, piece.text.indexOf(figure));
  const after = piece.text.slice(piece.text.indexOf(figure) + figure.length);
  const next = parts[at + 1];
  const following = next?.dependent && PARTICIPLE.test(next.text) && !/\d/.test(next.text) ? next.text : '';
  const means = `${MEANS.test(after) ? after : ''} ${following}`.trim();
  const head = piece.dependent ? (parts[at - 1]?.text ?? '') : '';
  const words = workWords(head || means ? `${head} ${means}` : before);
  const theirs = new Set(lines.flatMap((i) => [...i.words, ...i.role]));
  if ([...words.keys()].some((w) => theirs.has(w))) return null;
  const others = new Set(bullets.filter((i) => !lines.includes(i)).flatMap((i) => [...i.words, ...i.role]));
  const borrowed = [...words].filter(([w]) => others.has(w)).map(([, surface]) => `"${surface}"`);
  return borrowed.length > 0 ? borrowed.join(', ') : null;
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
  const inertAllowlist = [
    ...(input.allowMetrics ?? []).filter((e) => extractMetrics(normalizeText(e)).claims.length === 0),
    ...(input.allowFacts ?? []).filter((e) => canonicalizeAllowEntry(e) === null),
  ];
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
    // A title is a description, so every word of it need only appear somewhere
    // ("senior backend engineer" against "Senior Backend PHP Engineer"). A
    // company name is an identity and must match as one unit.
    const supported = a.kind === 'title'
      ? a.canonical.split(/[\s/]+/).every((w) => mentions(sourceText, w))
      : mentions(sourceText, a.canonical);
    if (supported) add({ ...a, status: 'supported', from: 'source' });
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

  // A true number told about other work is not an invented one: it warns, and
  // the caller decides what a warning stops (ADR 0020's verdicts stay as they were).
  const detached = input.resume ? detachedFigures(input.text, input.resume, input.replacing) : [];
  reasons.push(...detached.map((d) => d.reason));
  if (unchecked > 0) reasons.push(`${unchecked} claim${unchecked === 1 ? '' : 's'} could not be checked`);
  for (const e of inertAllowlist) reasons.push(`allowlist entry "${e}" can never match anything`);

  const verdict: FactVerdict = claims.some((c) => c.status === 'unsupported')
    ? 'block'
    : unchecked > 0 || detached.length > 0
      ? 'warn'
      : 'pass';
  return { verdict, claims, unchecked, inertAllowlist, detached, reasons };
}
