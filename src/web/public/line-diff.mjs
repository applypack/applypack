/*
 * Line diff for the targeted-resume page: what the user actually changed
 * between the text the AI analysed and the text in the editor. Dependency-free
 * ES module, no DOM — served as-is and unit-tested from src/web/target.test.ts.
 *
 * Lines are compared on a normalised key (trimmed, whitespace collapsed, curly
 * quotes folded) so a re-indent or a double space is not an edit, but every op
 * carries the ORIGINAL text — the change sheet quotes what is on screen, not
 * the key it matched on. Blank lines are lines: a lost paragraph gap is a real
 * change to a resume, and the .docx patcher in a later stage needs them.
 */

/** Above this a resume is not a resume; the LCS table is O(n·m) and this keeps it small. */
const MAX_LINES = 2000;

/**
 * How much of two lines' wording has to survive for one to be a rewrite of the
 * other rather than a deletion next to an unrelated addition. Measured as
 * shared words over all words: "Built payment systems." → "Built PHP/Laravel
 * payment systems at 99.9% uptime." is 0.43, "Drop me." → the same line is 0.
 */
const REWRITE_OVERLAP = 0.3;

function key(line) {
  return line
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function split(text) {
  return String(text ?? '')
    .split('\n')
    .slice(0, MAX_LINES);
}

function words(line) {
  return new Set(
    key(line)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

/** Shared words over all words — 1 for identical wording, 0 for two lines with nothing in common. */
function overlap(a, b) {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const w of left) if (right.has(w)) shared++;
  return shared / (left.size + right.size - shared);
}

/**
 * Longest common subsequence of the two line-key arrays, as a table of lengths.
 * Rows are built one at a time; only the full table is needed to walk back.
 */
function lcsTable(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * before, after → [{ op, a?, b? }] where op is 'keep' | 'change' | 'delete' |
 * 'insert', `a` is { i, text } in the before text and `b` the same in the
 * after text (both 0-based line indexes).
 *
 * A delete immediately followed by an insert is one 'change' — that is how a
 * reworded bullet reads to a person. A line MOVED elsewhere has no pairing
 * partner, so it comes out as a delete and an insert; the sheet says as much
 * rather than pretending to track it.
 */
export function diffLines(before, after) {
  const aLines = split(before);
  const bLines = split(after);
  const aKeys = aLines.map(key);
  const bKeys = bLines.map(key);
  const table = lcsTable(aKeys, bKeys);

  const raw = [];
  let i = 0;
  let j = 0;
  while (i < aLines.length && j < bLines.length) {
    if (aKeys[i] === bKeys[j]) {
      raw.push({ op: 'keep', a: { i, text: aLines[i] }, b: { i: j, text: bLines[j] } });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      raw.push({ op: 'delete', a: { i, text: aLines[i] } });
      i++;
    } else {
      raw.push({ op: 'insert', b: { i: j, text: bLines[j] } });
      j++;
    }
  }
  for (; i < aLines.length; i++) raw.push({ op: 'delete', a: { i, text: aLines[i] } });
  for (; j < bLines.length; j++) raw.push({ op: 'insert', b: { i: j, text: bLines[j] } });

  // A block of edits arrives as every delete then every insert. Zip them in
  // order — pairing the LAST delete with the FIRST insert, which is what a
  // naive "insert after delete" rule does, attributes each rewrite to the
  // wrong line. A pair only becomes a 'change' when the wording survived.
  const out = [];
  for (let k = 0; k < raw.length; ) {
    if (raw[k].op !== 'delete') {
      out.push(raw[k++]);
      continue;
    }
    let d = k;
    while (d < raw.length && raw[d].op === 'delete') d++;
    let ins = d;
    while (ins < raw.length && raw[ins].op === 'insert') ins++;
    const deletes = raw.slice(k, d);
    const inserts = raw.slice(d, ins);
    const paired = Math.min(deletes.length, inserts.length);
    let n = 0;
    for (; n < paired; n++) {
      if (overlap(deletes[n].a.text, inserts[n].b.text) < REWRITE_OVERLAP) break;
      out.push({ op: 'change', a: deletes[n].a, b: inserts[n].b });
    }
    out.push(...deletes.slice(n), ...inserts.slice(n));
    k = ins;
  }
  return out;
}
