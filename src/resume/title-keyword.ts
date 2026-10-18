// Whether a keyword is the posting's own job title. Mirrored line for line by
// src/web/public/title-keyword.mjs — change one, change the other;
// src/web/title-keyword.test.ts holds the two equal on every case.
//
// The brief carries the title as a keyword so the title line can take it
// (ADR 0044). It stays a gap, a chip and a part of the score. It is no skill:
// on a skills line it reads "Frameworks: …, Senior Software Engineer", and as a
// question — "do you have Product Lead?" — a yes unlocks it for bullets.
//
// Two ways a keyword is the title (#347):
//  - its letters and digits are the title's, whatever its priority;
//  - the model's shortening of it: priority 2 ("the exact job title as posted",
//    prompts.ts), two words or more, every one of them a word of the title —
//    "Product Lead" for "Product Lead (Strategy + Full Stack)".
// Priority 2 alone is not enough. Comparisons stored under earlier prompts
// carry real skills there ("Symfony", "React": 15 of 43 on one backup), and a
// term the person added at "preferred" is stored with priority 2 as well.

/** Letters and digits only, in one case: "Sr. Software Engineer II" is "srsoftwareengineerii". */
const lettersOf = (s: string | null | undefined): string => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** The words of a phrase, in one case, punctuation gone. */
const wordsOf = (s: string | null | undefined): string[] => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

/** The priority the prompt gives the posting's title. */
const TITLE_PRIORITY = 2;
/** A shortening has at least this many words: one word of a title ("PHP" in "PHP Developer") is a skill. */
const MIN_TITLE_WORDS = 2;

export function isTitleKeyword(keyword: { term: string; priority?: number; override?: { added?: boolean } | null }, jobTitle: string | null | undefined): boolean {
  const title = lettersOf(jobTitle);
  if (title === '' || keyword.override?.added === true) return false;
  if (lettersOf(keyword.term) === title) return true;
  if (keyword.priority !== TITLE_PRIORITY) return false;
  const inTitle = new Set(wordsOf(jobTitle));
  const words = wordsOf(keyword.term);
  return words.length >= MIN_TITLE_WORDS && words.every((w) => inTitle.has(w));
}
