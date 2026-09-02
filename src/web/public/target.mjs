/*
 * Keyword matcher for the targeted-resume page. Runs in the browser (served
 * as a static ES module) and under node:test. No DOM — pure functions over
 * strings and the keyword list the AI match produced.
 *
 * Live score = weighted keyword coverage. The AI decides WHAT the keywords
 * are (with requirement levels, aliases and cannot_claim); this module only
 * checks whether each one is present in the text the user is editing. The
 * full live score estimate (coverage + alignment − flags, capped) lives in
 * ./score.mjs.
 */

import { SCORING } from './score.mjs';

// Fallback for keyword rows that predate requirement levels (ADR 0012).
const PRIORITY_WEIGHT = { 1: 3, 2: 2, 3: 1, 4: 1 };

/**
 * The requirement level in force. A row the user re-levelled by hand carries
 * their choice in `override` (src/resume/keyword-overrides.ts); the panes and
 * the live editor are handed lists with that already applied, the
 * server-rendered keyword table is not — so read both here and neither caller
 * has to care.
 */
function levelOf(k) {
  return k.override?.requirement ?? k.requirement;
}

function keywordWeight(k) {
  const level = levelOf(k);
  if (level) return SCORING.requirementWeight[level] ?? 0;
  return PRIORITY_WEIGHT[k.priority] ?? 1;
}

/**
 * How loudly the posting asks for a term: 4 a primary-stack must · 3 must ·
 * 2 preferred · 1 nice · 0 context. One source for both the display order and
 * the intensity of the mark, so a missing must-have can never look like a
 * missing nice-to-have (target-plan.md §5).
 */
export function keywordRank(k) {
  const weight = keywordWeight(k);
  return k.primary === true && levelOf(k) === 'must' ? weight + 1 : weight;
}

/** Intensity class for a mark or a chip: kw-w0 (context) … kw-w4 (primary must). */
export function weightClass(k) {
  return 'kw-w' + keywordRank(k);
}

/** The requirement in words, for tooltips and chip titles. */
function wantsLabel(k) {
  const level = levelOf(k) ?? 'P' + k.priority;
  return k.primary === true ? level + ' · primary stack' : level;
}

/**
 * Display order for keyword lists: what the posting insists on hardest first,
 * ties broken by how often the posting repeats the term — a word said four
 * times outranks one said once at the same level. Every row comes back with
 * that `count`, so callers can say "×4 in the posting" without searching
 * again. Used by the panes, the missing chips and the server-rendered keyword
 * table: one implementation, nothing to mirror.
 */
export function orderKeywords(keywords, jobText) {
  return keywords
    .map((k) => ({ ...k, count: findTerm(jobText, k.term, k.aliases ?? []).length }))
    .sort(
      (a, b) =>
        keywordRank(b) - keywordRank(a) ||
        b.count - a.count ||
        (a.priority ?? 4) - (b.priority ?? 4) ||
        a.term.localeCompare(b.term),
    );
}
// A hit must not be glued to token characters: "C" is not "C++", "Java" is
// not "JavaScript", "x.php" is a file. A trailing "." before a space or the
// end of text ("PostgreSQL.") is punctuation, not part of the token.
const NOT_BEFORE = '(?<![\\w+#.])';
const NOT_AFTER = '(?![\\w+#])(?!\\.\\w)';

/**
 * Lowercase, straight quotes, tabs/NBSP as spaces. Every replacement is one
 * character for one, so an index into the normalised text is the same index
 * in the original — spans found here are applied to the original verbatim.
 */
export function normalise(s) {
  return foldChars(s).toLowerCase();
}

function foldChars(s) {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u00a0\t]/g, ' ');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Separators between the tokens of a multi-token term are interchangeable and
// optional: "CI/CD" = "CI / CD" = "CI-CD", "Node.js" = "NodeJS", "front-end" =
// "front end" = "frontend". Leading and trailing ones stay literal (".NET").
const SEPARATOR = '[\\s/.\\-]*';
const SEPARATOR_RUN = /[\s/.\-]+/;
const EDGES = /^([\s/.\-]*)(.*?)([\s/.\-]*)$/s;

/**
 * Regex fragment for the last token of a term: the token plus its regular
 * plural ("pipeline" → pipelines, "query" → queries, "class" → classes) and,
 * for a plural token, its singular ("microservices" → microservice, "APIs" →
 * API, "patches" → patch). A plural is a lowercase word or an acronym ending
 * in a lowercase s — Capitalised names that end in s (Rails, Windows,
 * Kubernetes) stay exact, and so do the two names whose lowercase alias
 * would otherwise light unrelated text ("light rail", "window functions").
 * No other stemming: irregular pairs belong in the alias table
 * (src/resume/keyword-aliases.ts).
 */
const NOT_PLURAL = new Set(['rails', 'windows']);

function pluralTolerant(token) {
  const t = token.toLowerCase();
  const literal = escapeRegex(t);
  if (t.length < 3 || !/[a-z]$/.test(t) || NOT_PLURAL.has(t)) return literal;
  if (t.endsWith('ss')) return `${literal}(?:es)?`;
  if (/^[a-z]{3,}s$/.test(token) || /^[A-Z0-9]{2,}s$/.test(token)) {
    if (t.endsWith('ies') && t.length >= 6) return `${escapeRegex(t.slice(0, -3))}(?:y|ie|ies)`;
    const stem = t.slice(0, -2);
    if (t.endsWith('es') && stem.length >= 4 && /(?:[sxz]|[cs]h)$/.test(stem)) return `${escapeRegex(stem)}(?:e|es)?`;
    return `${escapeRegex(t.slice(0, -1))}(?:e?s)?`;
  }
  if (t.length >= 4 && /[^aeiou]y$/.test(t)) return `${escapeRegex(t.slice(0, -1))}(?:y|ies)`;
  return `${literal}(?:e?s)?`;
}

/** Regex matching `term` as a whole token (no letters/digits/./+/# glued to it). */
export function termPattern(term) {
  const [, lead, core, trail] = EDGES.exec(foldChars(term).trim());
  const tokens = core.split(SEPARATOR_RUN).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const parts = tokens.map((t) => escapeRegex(t.toLowerCase()));
  if (trail === '') parts[parts.length - 1] = pluralTolerant(tokens[tokens.length - 1]);
  const body = escapeRegex(lead) + parts.join(SEPARATOR) + escapeRegex(trail);
  // Terms that start/end with a symbol (".net", "c++") cannot use \b; use lookarounds on token chars.
  return new RegExp(`${NOT_BEFORE}${body}${NOT_AFTER}`, 'g');
}

/** All occurrences of term + aliases in text → [{start, end}] on the ORIGINAL text (same length after normalise). */
export function findTerm(text, term, aliases = []) {
  const hay = normalise(text);
  const seen = new Set();
  const spans = [];
  for (const candidate of new Set([term, ...aliases])) {
    const re = termPattern(candidate);
    if (!re) continue;
    let m;
    while ((m = re.exec(hay)) !== null) {
      if (m[0].length === 0) re.lastIndex++;
      const key = `${m.index}:${m.index + m[0].length}`;
      // Aliases that spell the same span ("front end" / "frontend") count it once.
      if (seen.has(key)) continue;
      seen.add(key);
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Weighted coverage of the keyword list in `text`.
 * keywords: [{ term, priority, requirement?, status, aliases? }]. Excluded
 * from the coverage percentage: cannot_claim keywords (you cannot honestly
 * add them — unless includeCannotClaim is set) and zero-weight "context"
 * keywords. Every row still carries found/count for highlighting, and the
 * full rows feed entriesFromLive() in score.mjs for the live score estimate.
 */
export function scoreKeywords(keywords, text, { includeCannotClaim = false } = {}) {
  const rows = [];
  let earned = 0;
  let total = 0;
  for (const k of keywords) {
    const weight = keywordWeight(k);
    const excluded = (k.status === 'cannot_claim' && !includeCannotClaim) || weight === 0;
    const spans = findTerm(text, k.term, k.aliases ?? []);
    const found = spans.length > 0;
    if (!excluded) {
      total += weight;
      if (found) earned += weight;
    }
    rows.push({ ...k, count: spans.length, found, weight, excluded });
  }
  const score = total === 0 ? 0 : Math.round((earned / total) * 100);
  return { score, rows, earned, total };
}

/**
 * Where `quote` sits in `text`: exact match first, then whitespace/punctuation-
 * insensitive. Null when the AI paraphrased beyond recognition.
 */
export function locateQuote(text, quote) {
  if (!quote) return null;
  const exact = text.indexOf(quote);
  if (exact !== -1) return { start: exact, end: exact + quote.length };
  const loose = normalise(quote).replace(/[^\w]+/g, ' ').trim();
  if (loose.length < 8) return null;
  const pattern = loose
    .split(' ')
    .map(escapeRegex)
    .join('[^\\w]+');
  const m = new RegExp(pattern, 'i').exec(normalise(text).replace(/[^\w\n]+/g, (c) => ' '.repeat(c.length)));
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * text + spans [{start, end, cls, title?}] → HTML with <mark class=cls> wrappers.
 * Overlapping spans: the earlier-starting one wins; the rest are dropped.
 */
export function highlightHtml(text, spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let cursor = 0;
  for (const s of sorted) {
    if (s.start < cursor || s.end <= s.start) continue;
    out += escapeHtml(text.slice(cursor, s.start));
    const title = s.title ? ` title="${escapeHtml(s.title)}"` : '';
    out += `<mark class="${s.cls}"${title}>${escapeHtml(text.slice(s.start, s.end))}</mark>`;
    cursor = s.end;
  }
  return out + escapeHtml(text.slice(cursor));
}

/** Spans for the job-description pane: every keyword occurrence, classed by whether the resume has it. */
export function jobSpans(keywords, jobText, scored) {
  const byTerm = new Map(scored.rows.map((r) => [r.term, r]));
  // Same vocabulary as the keyword table and pane legends: matched / missing / confirm / no evidence.
  const LABEL = { 'kw-found': 'matched — in your resume', 'kw-cannot': "no evidence — can't claim", 'kw-ask': 'confirm — do you have it?', 'kw-missing': 'missing' };
  const spans = [];
  for (const k of keywords) {
    const row = byTerm.get(k.term);
    const found = row && row.found;
    const cls =
      k.status === 'cannot_claim' ? 'kw-cannot'
      : found ? 'kw-found'
      : k.status === 'ask_user' ? 'kw-ask'
      : 'kw-missing';
    // Every occurrence is already in hand, so the frequency costs nothing.
    const hits = findTerm(jobText, k.term, k.aliases ?? []);
    const often = hits.length > 1 ? ` · ×${hits.length} in the posting` : '';
    const title = `${k.term} · ${wantsLabel(k)} · ${LABEL[cls]}${often}`;
    for (const s of hits) {
      spans.push({ ...s, cls: `${cls} ${weightClass(k)}`, title });
    }
  }
  return spans;
}

/** Spans for the resume pane: present keywords, quoted removals, quoted actions. */
export function resumeSpans(keywords, actions, removals, resumeText) {
  const spans = [];
  // No weight class here: everything marked in the resume is a keyword the
  // resume HAS, and the sort below keys off a single class per span.
  for (const k of keywords) {
    for (const s of findTerm(resumeText, k.term, k.aliases ?? [])) {
      spans.push({ ...s, cls: 'kw-present', title: `${k.term} · ${wantsLabel(k)}` });
    }
  }
  for (const r of removals) {
    const loc = locateQuote(resumeText, r.quote);
    if (loc) spans.push({ ...loc, cls: 'edit-remove', title: `Remove: ${r.what}` });
  }
  for (const a of actions) {
    const loc = locateQuote(resumeText, a.quote);
    if (loc) spans.push({ ...loc, cls: 'edit-change', title: `Change: ${a.what}` });
  }
  // Edits outrank keyword marks when they overlap: sort edits first at equal starts.
  const rank = { 'edit-remove': 0, 'edit-change': 1, 'kw-present': 2 };
  return spans.sort((a, b) => a.start - b.start || rank[a.cls] - rank[b.cls]);
}
