/*
 * Figures an answer states that the person's own material does not (ADR
 * 0065). Pure. Digits read the same in every language, so this is the one
 * check that holds whatever language the history was written in and the
 * interview is held in. It marks, it never rewrites: the page says "check
 * this figure" beside the answer.
 */

/** "12 000" and "12 000" are one number; so are "1,200" and "1200", "2.5" and "2,5". */
const GROUP_SPACE_RE = /(\d)[   ](?=\d{3}(?!\d))/g;
const FIGURE_RE = /\d+(?:[.,]\d+)*/g;
const SEPARATOR_RE = /[.,]/g;

/** A lone digit is "two teams", "3 services" — too common to be a claim worth a mark. */
const MIN_DIGITS = 2;

function figuresOf(text: string): { shown: string; key: string }[] {
  const joined = text.replace(GROUP_SPACE_RE, '$1');
  return [...joined.matchAll(FIGURE_RE)].map((m) => ({ shown: m[0], key: m[0].replace(SEPARATOR_RE, '') }));
}

/** The figures of `text` that none of `sources` states, as written, each once. */
export function unbackedFigures(text: string, sources: readonly string[]): string[] {
  const known = new Set(sources.flatMap((s) => figuresOf(s).map((f) => f.key)));
  const out = new Set<string>();
  for (const f of figuresOf(text)) {
    if (f.key.length >= MIN_DIGITS && !known.has(f.key)) out.add(f.shown);
  }
  return [...out];
}
