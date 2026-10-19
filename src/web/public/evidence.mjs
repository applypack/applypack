/*
 * How strongly the resume shows a keyword — browser copy of
 * src/resume/evidence.ts, for the live score: since score v6 (ADR 0058) a
 * term the text names only on a list of terms earns less than one inside a
 * sentence about work, and the ring under the editor has to know which it is
 * on every keystroke. The rules are the server's, word for word.
 *
 * MIRROR: change evidence.ts and this file together — src/web/evidence.test.ts
 * runs both over one corpus.
 */

export const EVIDENCE_LEVELS = ['absent', 'listed', 'described', 'measured'];

/** Separators a resume uses between terms on one line. */
const SEPARATORS = [',', ' · ', ' | ', ';', ' • '];
/** A number that means something; a bare year or a version is not impact. */
const METRIC =
  /\d+\s*%|[$€£]\s?\d|\b\d[\d,.]*\s*(?:k|m|bn|b|x|ms|s|gb|tb|qps|rps|hrs?|hours?|days?|weeks?|months?|users?|customers?|requests?|events?|services?|engineers?|people|clients?|sites?|websites?)\b/i;
/** Words a list of terms has no use for. */
const GRAMMAR = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'by', 'at', 'from', 'that', 'this', 'as', 'is', 'was', 'were', 'are']);

/** The line a span sits on, and where on it. */
export function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return { line: text.slice(start, end === -1 ? text.length : end), column: index - start };
}

/** The dash between a title and what follows it on one line. */
const TITLE_DASH = / [—–] /;

/**
 * The part of a line around one position: a flattened table row is judged
 * cell by cell, and a term in a headline's stack ("Senior QA Engineer —
 * Playwright, TypeScript") by that list — never on a bullet or a role line.
 */
export function segmentAt(line, column) {
  let start = 0;
  let end = line.length;
  for (const sep of [' | ', '\t']) {
    const left = line.lastIndexOf(sep, column - 1);
    const right = line.indexOf(sep, column);
    if (left !== -1) start = Math.max(start, left + sep.length);
    if (right !== -1) end = Math.min(end, right);
  }
  const cell = line.slice(start, end);
  const dash = TITLE_DASH.exec(cell);
  if (dash !== null && column >= start + dash.index + dash[0].length && !/^\s*[-•*]/.test(cell)) {
    const tail = cell.slice(dash.index + dash[0].length);
    if (isTermList(tail)) return tail;
  }
  return cell;
}

/** Is this line a list of terms rather than a sentence? */
export function isTermList(line) {
  const colon = line.indexOf(':');
  const body = (colon === -1 ? line : line.slice(colon + 1)).trim().replace(/^[-•*]\s*/, '');
  if (body === '') return false;
  if (/[.!?](\s|$)/.test(body.slice(0, -1))) return false;
  const words = body.split(/\s+/);
  if (words.filter((w) => GRAMMAR.has(w.toLowerCase())).length * 5 > words.length) return false;
  for (const sep of SEPARATORS) {
    const parts = body.split(sep).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const short = parts.filter((p) => p.split(/\s+/).length <= 4).length;
    if (short === parts.length || (parts.length >= 6 && short * 5 >= parts.length * 4)) return true;
  }
  return false;
}

/** The strongest evidence the term's hits — `spans`, from the matcher — offer in `text`. */
export function evidenceOf(text, spans) {
  let best = 'absent';
  for (const span of spans) {
    const at = lineAt(text, span.start);
    const line = segmentAt(at.line, at.column);
    const level = isTermList(line) ? 'listed' : METRIC.test(line) ? 'measured' : 'described';
    if (EVIDENCE_LEVELS.indexOf(level) > EVIDENCE_LEVELS.indexOf(best)) best = level;
  }
  return best;
}
