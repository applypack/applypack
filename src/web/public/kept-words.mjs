/*
 * How much of the text an analysis read is still in the editor. The live
 * score (score.mjs) counts the keywords as they are typed, but two of its
 * parts are the last analysis's judgment of the text it read: the alignment —
 * how the title, the summary and the latest role read, up to 40 points — and
 * half credit for a keyword it saw that has since been deleted (ADR 0045).
 * Once too little of that text is left, both describe a resume that is gone:
 * an emptied editor still scored 63. Below the floor the Tailor page shows no
 * number and points at the next analysis instead.
 *
 * Words, not characters: a rewrite that keeps the facts keeps most of the
 * words, another resume pasted over it keeps few. A word counts once.
 */

/** Below this share of the analysed text's words, the page shows no live score. */
export const KEPT_FLOOR = 0.6;

/** The distinct words of a text, in one case: letters and digits in any script. */
export function wordsOf(text) {
  return new Set(String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu));
}

/** The share (0–1) of the analysed words (`wordsOf`) that `text` still has; nothing to lose when there were none. */
export function shareKept(analysed, text) {
  if (analysed.size === 0) return 1;
  const now = wordsOf(text);
  let kept = 0;
  for (const word of analysed) if (now.has(word)) kept++;
  return kept / analysed.size;
}
