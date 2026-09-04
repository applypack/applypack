/*
 * The edits the suggestion cards can make to the resume text: replace a quoted
 * span, cut one, add a term to a skills line — and the inverse of any of them,
 * which is what Undo restores. Dependency-free ES module, no DOM — served
 * as-is and unit-tested from src/web/text-edits.test.ts.
 *
 * There is deliberately no "move this bullet to the top". 24 stored actions use
 * move/lead wording, and reading them shows the model means "make the first
 * bullet say this" — it quotes the leading bullet and proposes new words for
 * it, which is a replacement. A real move applied to only 4 of the 24.
 *
 * Every function is total: it returns either { text, span } — the whole new
 * text plus where the edit landed, so the caller can outline it — or
 * { error }, never a partial write and never a throw. The caller keeps the old
 * text for Undo; nothing here mutates.
 *
 * It lives beside target.mjs rather than inside it because the landing demo
 * ships a byte copy of that file (site-vendor.test.ts) and imports it in the
 * browser; this module is dashboard-only.
 */

import { locateQuote, findTerm } from './target.mjs';

/*
 * The contact line is protected: gotcha 11 is that removal quotes leak into it,
 * and 7 of the 237 quoted spans in the live corpus sit on the line carrying the
 * email and phone. These two patterns are copied from
 * src/resume/parse-warnings.ts — a browser module cannot import TypeScript, so
 * they are kept in step by hand.
 */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RUN_RE = /\+?\d[\d\s().\/-]{6,}\d/g;
/** A phone needs ≥9 digits in one run — "2022-2026" date ranges have 8. */
const PHONE_MIN_DIGITS = 9;

function isContactLine(line) {
  if (EMAIL_RE.test(line)) return true;
  return (line.match(PHONE_RUN_RE) ?? []).some((run) => (run.match(/\d/g) ?? []).length >= PHONE_MIN_DIGITS);
}

/** Start of the line containing `index`. */
function lineStart(text, index) {
  return text.lastIndexOf('\n', index - 1) + 1;
}

/** End of the line containing `index`, not counting the newline. */
function lineEnd(text, index) {
  const next = text.indexOf('\n', index);
  return next === -1 ? text.length : next;
}

/** Every line the span [start, end) touches, as one string. */
function affectedLines(text, start, end) {
  return text.slice(lineStart(text, start), lineEnd(text, end));
}

// A bullet marker the edit must not eat when it replaces the words after it.
const BULLET = /^(\s*(?:[-•*·–—]|\d+[.)])\s+)/;

/**
 * Replace the quoted span with `replacement`. The span is found the same way
 * the editor highlights it, so what gets replaced is what was outlined.
 * A leading bullet marker survives: the model quotes the sentence, not the "• ".
 */
export function applyReplacement(text, quote, replacement) {
  const loc = locateQuote(text, quote);
  if (!loc) return { error: 'not-found' };
  if (typeof replacement !== 'string' || replacement.trim() === '') return { error: 'no-replacement' };
  const start = lineStart(text, loc.start);
  const marker = BULLET.exec(text.slice(start, loc.end));
  // Only when the quote swallowed the marker: otherwise it is already outside the span.
  const keep = marker && loc.start <= start + marker[1].length ? marker[1] : '';
  const body = keep + replacement.trim();
  const from = keep ? start : loc.start;
  return { text: text.slice(0, from) + body + text.slice(loc.end), span: { start: from, end: from + body.length } };
}

/**
 * Cut the quoted span. When the quote is the whole line, the line goes with its
 * newline so no blank gap is left behind. Refuses on the contact line — dropping
 * a ZIP code there has taken the email with it before (gotcha 11).
 */
export function removeSpan(text, quote) {
  const loc = locateQuote(text, quote);
  if (!loc) return { error: 'not-found' };
  if (affectedLines(text, loc.start, loc.end).split('\n').some(isContactLine)) return { error: 'protected' };
  const start = lineStart(text, loc.start);
  const end = lineEnd(text, loc.end);
  const wholeLine = text.slice(start, loc.start).trim() === '' && text.slice(loc.end, end).trim() === '';
  const from = wholeLine ? start : loc.start;
  // Take the trailing newline with the line; at the end of the text take the leading one.
  const to = wholeLine ? (end < text.length ? end + 1 : end) : loc.end;
  const cutLeadingNewline = wholeLine && end >= text.length && from > 0;
  const next = text.slice(0, cutLeadingNewline ? from - 1 : from) + text.slice(to);
  const at = cutLeadingNewline ? from - 1 : from;
  return { text: next, span: { start: at, end: at } };
}

/** The separators a skills line uses between terms, most specific first. */
const SEPARATORS = [' | ', ' · ', ' • ', '; ', ', '];

/**
 * Is this line a list of terms, rather than a bare label or a run of labels?
 * Measured need: on all six resumes in the live corpus the skills section is a
 * column of bare labels with the values stacked below, so appending to "the
 * line that says Programming" would write the term onto a label while the real
 * list sits further down.
 */
function termList(line) {
  const colon = line.indexOf(':');
  const body = (colon === -1 ? line : line.slice(colon + 1)).trim();
  if (body === '') return null;
  for (const sep of SEPARATORS) {
    const parts = body.split(sep).map((p) => p.trim());
    // Two real items, and no item that is itself another label.
    if (parts.length >= 2 && parts.every((p) => p !== '' && !p.endsWith(':'))) return { body, sep };
  }
  return null;
}

const SKILLS_HEADING = /skills|technolog|stack|competenc/i;
const HEADING_MAX = 60;

/**
 * Add `term` to a skills line. Only ever writes inside a skills section: a term
 * list somewhere else is not a skills list, and the first walk of this shipped
 * appending a keyword to the contact line, which split on ", " into four parts
 * and passed for one. Returns `no-skills-list` when there is nothing safe to
 * write to — the caller must then not offer the button at all rather than offer
 * one that writes nonsense. A term already present is a no-op.
 */
export function insertIntoSkills(text, term, where) {
  const clean = String(term ?? '').trim();
  if (clean === '') return { error: 'no-term' };
  if (findTerm(text, clean).length > 0) return { error: 'already-present' };

  const lines = text.split('\n');
  const lists = [];
  let underHeading = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const list = termList(line);
    // A bare label ("Programming:") belongs to the section it sits in and must
    // not close it — every stored resume stacks its labels that way.
    const isLabel = line.trimEnd().endsWith(':');
    if (!list && !isLabel && line.trim() !== '' && line.length < HEADING_MAX) {
      underHeading = SKILLS_HEADING.test(line);
    }
    if (list && underHeading && !isContactLine(line)) lists.push({ i, ...list });
  }
  if (lists.length === 0) return { error: 'no-skills-list' };

  // The hint names a category ("Key Skills, Programming line"); prefer a list whose label says so.
  const hint = String(where ?? '').toLowerCase();
  const hintWords = hint.match(/[a-z]{4,}/g) ?? [];
  const label = (i) => lines[i].toLowerCase().slice(0, lines[i].indexOf(':') + 1 || HEADING_MAX);
  const target = lists.find((l) => hintWords.some((w) => label(l.i).includes(w))) ?? lists[0];

  const line = lines[target.i];
  const next = line.replace(/\s*$/, '') + target.sep + clean;
  lines[target.i] = next;
  const start = lines.slice(0, target.i).reduce((n, l) => n + l.length + 1, 0) + next.length - clean.length;
  return { text: lines.join('\n'), span: { start, end: start + clean.length } };
}

/**
 * The smallest edit that turns `before` into `after`: the common prefix and
 * suffix are untouched, everything between them changed. Undo stores this
 * rather than a copy of the whole resume — it is one sentence, it survives a
 * reload in localStorage, and it says exactly what to put back.
 */
export function inverseEdit(before, after) {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  return {
    start: head,
    removed: before.slice(head, before.length - tail),
    inserted: after.slice(head, after.length - tail),
  };
}

/**
 * Put `edit.removed` back where `edit.inserted` still stands. Refuses when the
 * text has moved on, so Undo can never silently overwrite later typing.
 */
export function undoEdit(text, edit) {
  const at = edit.start;
  if (text.slice(at, at + edit.inserted.length) !== edit.inserted) return { error: 'moved-on' };
  const next = text.slice(0, at) + edit.removed + text.slice(at + edit.inserted.length);
  return { text: next, span: { start: at, end: at + edit.removed.length } };
}
