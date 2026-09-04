/*
 * Characters the bundled face cannot draw, folded to ones it can (ADR 0039).
 * Pure — a string in, a string out.
 *
 * Found live, not imagined: resume 5's PDF carries "O(N2log2N)" written as
 * MATHEMATICAL ITALIC CAPITAL O (U+1D442) and friends, because the .docx it
 * was printed from keeps that line in a Word formula object set in Cambria
 * Math. Liberation Sans has no glyphs in that block, so the line rendered as
 * a row of ☐. A mathematical italic N *is* an N, and an N the reader can read
 * beats a box — so the compatibility decomposition is used where it yields
 * drawable text, and nothing else is touched.
 *
 * Applied in the shared plan rather than in one writer, so the .docx and the
 * .pdf carry the same characters: the .docx names Arial, which has no math
 * italics either, and Word would silently substitute a different face.
 *
 * KEPT_RANGES is a CLAIM ABOUT THE SHIPPED FONT, and drawable.test.ts walks
 * every codepoint in it against both faces — which is how the holes below are
 * known rather than guessed (the C1 controls, the unassigned Greek slots, and
 * the currency signs newer than the font).
 */

/** Ranges both bundled faces cover completely — enforced by the test, not assumed. */
const KEPT_RANGES: Array<[number, number]> = [
  [0x0020, 0x007e], // ASCII, printable
  [0x00a0, 0x02ff], // Latin-1 Supplement through Latin Extended-B and the IPA
  [0x0384, 0x038a], // Greek: the assigned run either side of the reserved slots
  [0x038c, 0x038c],
  [0x038e, 0x03a1],
  [0x03a3, 0x03ce],
  [0x0400, 0x04ff], // Cyrillic, whole
];

/**
 * Punctuation, currency and symbols worth keeping, as an explicit list rather
 * than a range: General Punctuation is full of holes this face does not fill
 * (U+2011 among them, which is why it is absent here and folds to U+2010).
 */
const KEPT_SINGLES = new Set([
  '\t', '\n',
  '‐', '–', '—', '‘', '’', '‚', '“', '”', '„',
  '†', '‡', '•', '…', '‰', '′', '″', '‹', '›',
  '€', '₣', '₤', '₧', '₰', '₱', '₵',
  '←', '↑', '→', '↓', '−', '≠', '≤', '≥', '™', '№',
  // U+2219 BULLET OPERATOR: what the corpus uses between the parts of a
  // contact line and a role's location. Dropping it ran two places together.
  '∙', '∞', '≈', '∑', '√', '∫', '∆', '∏',
]);

export function isKept(ch: string): boolean {
  if (KEPT_SINGLES.has(ch)) return true;
  const code = ch.codePointAt(0) ?? 0;
  return KEPT_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/** The ranges and singles the test walks against the font files. */
export function keptCodePoints(): number[] {
  const out: number[] = [];
  for (const [lo, hi] of KEPT_RANGES) for (let c = lo; c <= hi; c++) out.push(c);
  for (const ch of KEPT_SINGLES) if (ch !== '\t' && ch !== '\n') out.push(ch.codePointAt(0)!);
  return out;
}

/**
 * Folds what the face cannot draw. A character outside the kept set is
 * replaced by its compatibility decomposition when that decomposition is
 * itself drawable — 𝑁 → N, ₂ → 2, ﬁ → fi — and otherwise dropped, because a
 * box in the middle of a sentence is worse than the sentence without it.
 */
export function drawable(text: string): string {
  // The common case by far: nothing to do, and no allocation to do it with.
  if (![...text].some((ch) => !isKept(ch))) return text;
  let out = '';
  for (const ch of text) {
    if (isKept(ch)) {
      out += ch;
      continue;
    }
    const folded = ch.normalize('NFKD');
    out += [...folded].every((c) => isKept(c)) ? folded : '';
  }
  // Dropping a character can leave a double space behind it.
  return out.replace(/[ \t]{2,}/g, ' ');
}

/** What a string would lose entirely — for a log line, not for the UI. */
export function undrawable(text: string): string[] {
  return [...text].filter((ch) => !isKept(ch) && [...ch.normalize('NFKD')].some((c) => !isKept(c)));
}
