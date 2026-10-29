import path from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * The browser's line diff, on the server (ADR 0038). The change sheet and the
 * .docx patcher have to agree on what an edit is, so there is one
 * implementation — src/web/public/line-diff.mjs — and this is the bridge to
 * it, the way keyword-matcher.ts bridges to target.mjs.
 */

export interface DiffLine {
  i: number;
  text: string;
}

export type DiffOp =
  | { op: 'keep'; a: DiffLine; b: DiffLine }
  | { op: 'change'; a: DiffLine; b: DiffLine }
  | { op: 'delete'; a: DiffLine }
  | { op: 'insert'; b: DiffLine };

interface LineDiffModule {
  diffLines(before: string, after: string): DiffOp[];
}

// A file URL, as keyword-matcher.ts explains.
const MODULE_URL = pathToFileURL(path.resolve('src/web/public/line-diff.mjs')).href;

let mod: Promise<LineDiffModule> | undefined;

export function loadLineDiff(): Promise<LineDiffModule> {
  mod ??= import(MODULE_URL) as Promise<LineDiffModule>;
  return mod;
}

/**
 * Every delete followed directly by an insert, read as one line rewritten.
 * `diffLines` keeps a rewording that lost two thirds of its words apart, as
 * a delete and an insert, and a card that lists what was changed then
 * counted a rewritten title twice — "5 lines" for four edits (#642; Save as
 * vN counts them as one since #664). Runs pair in order, the rest of a
 * longer run stays as it was. Before the keeps are dropped: a delete and an
 * insert with a kept line between them are two edits.
 */
export function asRewrites(ops: readonly DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (let k = 0; k < ops.length; ) {
    let d = k;
    while (ops[d]?.op === 'delete') d++;
    let i = d;
    while (ops[i]?.op === 'insert') i++;
    if (d === k) {
      out.push(ops[k++]!);
      continue;
    }
    const deletes = ops.slice(k, d) as Extract<DiffOp, { op: 'delete' }>[];
    const inserts = ops.slice(d, i) as Extract<DiffOp, { op: 'insert' }>[];
    const paired = Math.min(deletes.length, inserts.length);
    for (let n = 0; n < paired; n++) out.push({ op: 'change', a: deletes[n]!.a, b: inserts[n]!.b });
    out.push(...deletes.slice(paired), ...inserts.slice(paired));
    k = i;
  }
  return out;
}
