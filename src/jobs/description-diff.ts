import type { DiffOp } from '../resume/line-diff';

/*
 * What "Refresh the description from the company's listing" is about to do
 * (#162 stage 3, ADR 0043), as numbers and as the words the page says.
 * Pure: the caller fetches the page (jobs/posting-url.ts) and runs the line
 * diff (resume/line-diff.ts); this reads the result. The floor for "a
 * posting" is manual-job.ts's, so a page that is really a login wall or a
 * cookie notice is refused the same way a paste would be.
 */

export interface RefreshPlan {
  /** Byte-identical after normalisation — nothing to replace. */
  unchanged: boolean;
  before: number;
  after: number;
  /** Lines the listing has that the stored text does not, and the reverse. */
  added: number;
  removed: number;
  /** Whether the page names the posting's title — a board's index page or a login wall does not. */
  mentionsTitle: boolean;
}

/** One row of the preview: a line kept, dropped or added, or a fold over unchanged lines. */
export type PreviewRow =
  | { kind: 'keep' | 'delete' | 'insert'; text: string }
  | { kind: 'fold'; count: number };

/** Unchanged lines shown around a change; longer runs fold into a count. */
const FOLD_CONTEXT = 3;

/** Line endings and outer whitespace only — the words are the page's. */
export function normaliseDescription(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

export function planRefresh(current: string, fetched: string, ops: DiffOp[], title: string): RefreshPlan {
  const before = normaliseDescription(current);
  const after = normaliseDescription(fetched);
  const mentionsTitle = title.trim() === '' || after.toLowerCase().includes(title.trim().toLowerCase());
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.op === 'insert') added += 1;
    else if (op.op === 'delete') removed += 1;
    else if (op.op === 'change') {
      added += 1;
      removed += 1;
    }
  }
  return { unchanged: before === after, before: before.length, after: after.length, added, removed, mentionsTitle };
}

/** The diff as the page draws it: every change with a little context, long unchanged runs folded. */
export function foldOps(ops: DiffOp[]): PreviewRow[] {
  const rows: PreviewRow[] = [];
  let kept: string[] = [];
  const flush = (trailing: number) => {
    // `trailing` lines stay visible before the next change; the leading ones
    // after the previous change were already emitted.
    if (kept.length > trailing + FOLD_CONTEXT) {
      const shown = rows.length === 0 ? 0 : FOLD_CONTEXT;
      for (const text of kept.slice(0, shown)) rows.push({ kind: 'keep', text });
      const hidden = kept.length - shown - trailing;
      if (hidden > 0) rows.push({ kind: 'fold', count: hidden });
      for (const text of kept.slice(kept.length - trailing)) rows.push({ kind: 'keep', text });
    } else {
      for (const text of kept) rows.push({ kind: 'keep', text });
    }
    kept = [];
  };
  for (const op of ops) {
    if (op.op === 'keep') {
      kept.push(op.a.text);
      continue;
    }
    flush(FOLD_CONTEXT);
    if (op.op === 'delete' || op.op === 'change') rows.push({ kind: 'delete', text: op.a.text });
    if (op.op === 'insert' || op.op === 'change') rows.push({ kind: 'insert', text: op.b.text });
  }
  flush(0);
  return rows;
}

/** The page's one-line summary of the swap. */
export function describeRefresh(plan: RefreshPlan): string {
  if (plan.unchanged) return `The company's listing reads the same as the stored description (${plan.before.toLocaleString('en-US')} characters) — nothing to replace.`;
  const size =
    plan.after > plan.before
      ? `${plan.after.toLocaleString('en-US')} characters instead of ${plan.before.toLocaleString('en-US')}`
      : plan.after === plan.before
        ? `the same ${plan.after.toLocaleString('en-US')} characters, differently worded`
        : `${plan.after.toLocaleString('en-US')} characters instead of ${plan.before.toLocaleString('en-US')} — shorter`;
  return `${size}: ${plan.added} line${plan.added === 1 ? '' : 's'} added, ${plan.removed} removed.`;
}

/** The flash after the swap, naming what changed and what it set in motion. */
export function refreshFlash(before: number, after: number, reclassified: boolean): string {
  const sizes = `${before.toLocaleString('en-US')} → ${after.toLocaleString('en-US')} characters`;
  const scored = reclassified
    ? 'Re-classified against your running searches'
    : 'No running search to re-classify against';
  return `Description replaced with the company's listing (${sizes}); the original is kept. ${scored}; the next comparison reads the posting afresh.`;
}

/** The flash after "Restore the original". */
export function restoreFlash(chars: number, reclassified: boolean): string {
  const scored = reclassified ? 'Re-classified' : 'No running search to re-classify against';
  return `Original description restored (${chars.toLocaleString('en-US')} characters). ${scored}; the next comparison reads the posting afresh.`;
}
