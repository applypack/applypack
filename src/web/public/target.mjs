/*
 * Keyword matcher for the targeted-resume page. Runs in the browser (served
 * as a static ES module) and under node:test. No DOM, no imports — pure
 * functions over strings and the keyword list the AI match produced.
 *
 * Live score = weighted keyword coverage. The AI decides WHAT the keywords
 * are (with priorities, aliases and cannot_claim); this module only checks
 * whether each one is present in the text the user is editing.
 */

const PRIORITY_WEIGHT = { 1: 3, 2: 2, 3: 1, 4: 1 };
// A hit must not be glued to token characters: "C" is not "C++", "Java" is
// not "JavaScript", "x.php" is a file. A trailing "." before a space or the
// end of text ("PostgreSQL.") is punctuation, not part of the token.
const NOT_BEFORE = '(?<![\\w+#.])';
const NOT_AFTER = '(?![\\w+#])(?!\\.\\w)';

/** Lowercase, straight quotes, single spaces — the comparison form of any text. */
export function normalise(s) {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex matching `term` as a whole token (no letters/digits/./+/# glued to it). */
export function termPattern(term) {
  const t = escapeRegex(normalise(term).trim());
  if (t.length === 0) return null;
  // Terms that start/end with a symbol (".net", "c++") cannot use \b; use lookarounds on token chars.
  return new RegExp(`${NOT_BEFORE}${t}${NOT_AFTER}`, 'g');
}

/** All occurrences of term + aliases in text → [{start, end}] on the ORIGINAL text (same length after normalise). */
export function findTerm(text, term, aliases = []) {
  const hay = normalise(text);
  const spans = [];
  for (const candidate of new Set([term, ...aliases])) {
    const re = termPattern(candidate);
    if (!re) continue;
    let m;
    while ((m = re.exec(hay)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Weighted coverage of the keyword list in `text`.
 * keywords: [{ term, priority, status, aliases? }]. cannot_claim keywords are
 * excluded unless includeCannotClaim is set — you cannot honestly add them.
 */
export function scoreKeywords(keywords, text, { includeCannotClaim = false } = {}) {
  const rows = [];
  let earned = 0;
  let total = 0;
  for (const k of keywords) {
    const excluded = k.status === 'cannot_claim' && !includeCannotClaim;
    const spans = findTerm(text, k.term, k.aliases ?? []);
    const weight = PRIORITY_WEIGHT[k.priority] ?? 1;
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
  const spans = [];
  for (const k of keywords) {
    const row = byTerm.get(k.term);
    const cls = k.status === 'cannot_claim' ? 'kw-cannot' : row && row.found ? 'kw-found' : 'kw-missing';
    for (const s of findTerm(jobText, k.term, k.aliases ?? [])) {
      spans.push({ ...s, cls, title: `${k.term} · P${k.priority} · ${cls === 'kw-found' ? 'in resume' : cls === 'kw-cannot' ? "can't claim" : 'missing'}` });
    }
  }
  return spans;
}

/** Spans for the resume pane: present keywords, quoted removals, quoted actions. */
export function resumeSpans(keywords, actions, removals, resumeText) {
  const spans = [];
  for (const k of keywords) {
    for (const s of findTerm(resumeText, k.term, k.aliases ?? [])) {
      spans.push({ ...s, cls: 'kw-present', title: `${k.term} · P${k.priority}` });
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
