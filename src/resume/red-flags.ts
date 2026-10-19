import type { KeywordMatcher } from './keyword-matcher';
import type { MatchKeyword } from './prompts';

/*
 * Which red flags the penalty is allowed to charge for.
 *
 * A red flag costs ten points, and the variance fixture found that one line the
 * model may or may not bother to write was 80% of a ten-point spread across
 * five runs of one pair. Reading the flags explains it: every run said "the
 * primary language group is not evidenced", two of them added "React appears
 * nowhere either". Both sentences are about keywords, and the keyword pool has
 * already priced both — a term the resume cannot claim earns zero out of its
 * weight. Charging ten more for saying so is the same fact billed twice, and
 * whether it gets billed depends on the model's mood.
 *
 * So a flag that names a keyword the resume does not have does not count. Nor
 * does one naming a keyword the resume shows only on a skills line: "X appears
 * only in the skills line" is on the prompt's own list of things that are never
 * red flags, `evidence: listed` measures exactly that, and the product already
 * answers it with a suggestion rather than a penalty. Five runs after the first
 * fix, one run in five still wrote that sentence and it was the whole residual.
 * Nor does one naming a keyword the resume spells only through an alias — "PHP"
 * for the posting's "PHP 8": the row's badge already says to write the posting's
 * spelling (`annotateAliasOnly`), and once anchoring (ADR 0045) has called the
 * term present, a flag about the version was ten points for the same fact (#204).
 *
 * What still counts is the list that is not made of keywords at all and that no
 * edit can fix: a location or on-site mismatch, work authorization, a minimum
 * the candidate misses, a seniority the posting excludes, an injection attempt.
 *
 * This replaces scoring v3's narrower rule ("flags duplicating a MISSING
 * PRIMARY item are free, the cap already punishes the stack") — same idea, one
 * mechanism instead of two, and it no longer needs the cap to be biting.
 * Pure: the matcher arrives as an argument.
 */

export interface FlagReport {
  /** Flags the penalty charges for. */
  counted: string[];
  /** Flags the keyword pool already priced, with the term each one restates. */
  exempt: { flag: string; term: string }[];
}

export function countableFlags(
  flags: string[],
  keywords: MatchKeyword[],
  matcher: Pick<KeywordMatcher, 'findTerm'>,
): FlagReport {
  // A keyword the resume does not have, has only as a name on a skills line, or
  // spells only through an alias — each already answered, by its zero credit, by
  // the suggestion that puts it in a bullet, or by the badge that asks for the
  // posting's spelling. A keyword genuinely shown in the work, in the posting's
  // own words, is not a gap, so a flag naming that one is about something else and counts.
  const gaps = keywords.filter((k) => k.status !== 'present' || k.evidence === 'listed' || Boolean(k.aliasOnly));
  const counted: string[] = [];
  const exempt: { flag: string; term: string }[] = [];
  for (const flag of flags) {
    const named = gaps.find((k) => matcher.findTerm(flag, k.term, k.aliases ?? []).length > 0);
    if (named) exempt.push({ flag, term: named.term });
    else counted.push(flag);
  }
  return { counted, exempt };
}

export interface ShownFlags {
  /** What the red flags list shows: the flags the score charged for. */
  redFlags: string[];
  /** Exempt flags that are true and free — shown among the cautions. */
  cautions: string[];
}

/**
 * Where each flag is shown, so the page says what the score did (#591). A
 * counted flag is a red flag. An exempt one about a term the resume does not
 * have is true and cost nothing: a caution. An exempt one about a term the text
 * does spell — on a skills line only, or under another spelling — says "no X
 * anywhere" about a word the reader can see, and the keyword table already says
 * where X stands: it is not shown.
 */
export function shownFlags(
  flags: string[],
  keywords: MatchKeyword[],
  matcher: Pick<KeywordMatcher, 'findTerm'>,
): ShownFlags {
  const { counted, exempt } = countableFlags(flags, keywords, matcher);
  const spelled = new Set(keywords.filter((k) => k.status === 'present').map((k) => k.term));
  return { redFlags: counted, cautions: exempt.filter((e) => !spelled.has(e.term)).map((e) => e.flag) };
}
