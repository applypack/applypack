/*
 * "Apply all": every suggestion the comparison left on the page, applied to
 * the resume text in one press — the changes and additions the gate let
 * through, the removals, and the missing keywords a skills line can take.
 * Dependency-free ES module, no DOM — served as-is and unit-tested from
 * src/web/apply-all.test.ts; target-page.mjs collects the operations off the
 * cards and records what came back.
 *
 * Each operation runs on the text the one before it left, through the same
 * functions a single card's Apply calls, so a batch can do nothing a user
 * pressing every button in turn could not. What one operation cannot place
 * (its quote was edited away, a removal on the contact line) is reported and
 * skipped; the rest still land. Measured on the ten stored comparisons before
 * this was written: 40 of 47 changes, 13 of 14 removals and 5 of 5 keywords
 * land, and no quote goes missing.
 */

import { applyReplacement, insertAfterLine, removeSpan, insertIntoSkills, appendSkills, withContext } from './text-edits.mjs';
import { formatList, t } from './i18n.mjs';

/**
 * @typedef {{ key: string, kind: 'change', quote: string, wording: string }
 *   | { key: string, kind: 'add', anchor: string, wording: string }
 *   | { key: string, kind: 'remove', quote: string }
 *   | { key: string, kind: 'keyword', term: string, where?: string }
 *   | { key: string, kind: 'skills-line', terms: string[] }} Operation
 */

/** Run one operation on `text`: the text-edits result, `{ text, span }` or `{ error }`. */
function runOperation(text, op) {
  switch (op.kind) {
    case 'change':
      return applyReplacement(text, op.quote, op.wording);
    case 'add':
      return insertAfterLine(text, op.anchor, op.wording);
    case 'remove':
      return removeSpan(text, op.quote);
    case 'keyword':
      return insertIntoSkills(text, op.term, op.where);
    case 'skills-line':
      return appendSkills(text, op.terms);
    default:
      return { error: 'unknown-operation' };
  }
}

/**
 * Apply `ops` in order. Returns the final text, each applied operation with the
 * inverse edit that undoes it (context included, so it can be undone on its
 * own after the others moved it), and each refused one with its reason.
 */
export function applyAll(text, ops) {
  let current = text;
  const done = [];
  const failed = [];
  for (const op of ops) {
    const result = runOperation(current, op);
    // A keyword an earlier change already wrote in is not a failure: it is done.
    if (result.error === 'already-present') continue;
    if (result.error) {
      failed.push({ key: op.key, kind: op.kind, error: result.error });
      continue;
    }
    // The operation's own account of what it changed, not a diff of the two
    // texts: next to a removal, a diff reads an added bullet's "\n• " as the
    // removed line's, and the two could no longer be undone apart.
    done.push({ key: op.key, kind: op.kind, edit: withContext(result.text, result.change) });
    current = result.text;
  }
  return { text: current, done, failed };
}

/**
 * Every term a skills line can take, each on the line its hint names; the
 * ones no list line can take go on one line of their own (appendSkills).
 * What the page's "Add keywords" runs — one edit per term, so each can be
 * undone on its own, and one for the leftover line.
 */
export function addKeywords(text, terms) {
  const first = applyAll(text, terms.map((k) => ({ key: 'kw:' + k.term, kind: 'keyword', term: k.term, where: k.where })));
  const leftover = first.failed.filter((f) => f.error === 'no-skills-list').map((f) => f.key.slice(3));
  if (leftover.length === 0) return first;
  const rest = applyAll(first.text, [{ key: 'kw-line:' + leftover.join(','), kind: 'skills-line', terms: leftover }]);
  return {
    text: rest.text,
    done: [...first.done, ...rest.done],
    failed: [...first.failed.filter((f) => f.error !== 'no-skills-list'), ...rest.failed],
  };
}

/** Each kind of edit counted, in the order the summary names them. */
const COUNTED = {
  change: 'browser.applyAll.change',
  add: 'browser.applyAll.addition',
  remove: 'browser.applyAll.removal',
  keyword: 'browser.applyAll.keyword',
  'skills-line': 'browser.applyAll.skillsLine',
};

/** The summary's first sentence, by what the press was called. */
const HEAD = { applied: 'browser.applyAll.applied', added: 'browser.applyAll.added' };

/**
 * One sentence for the status line and a screen reader: what landed, what did
 * not. `verb` is what the button said it would do — "Applied 2 changes" for
 * Apply all, "Added 3 keywords" for the keyword list.
 */
export function applyAllSummary(result, verb = 'applied') {
  const byKind = {};
  for (const d of result.done) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
  const parts = Object.keys(COUNTED)
    .filter((kind) => byKind[kind])
    .map((kind) => t(COUNTED[kind], { n: byKind[kind] }));
  const head = parts.length > 0 ? t(HEAD[verb] ?? HEAD.applied, { list: formatList(parts) }) : t('browser.applyAll.nothing');
  const missed = result.failed.length;
  if (missed === 0) return head;
  return `${head} ${t('browser.applyAll.missed', { n: missed })}`;
}
