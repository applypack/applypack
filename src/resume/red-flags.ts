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
 * So a flag that names a keyword the resume does not have does not count. What
 * still counts is the list that is not made of keywords at all and that no edit
 * can fix: a location or on-site mismatch, work authorization, a minimum the
 * candidate misses, a seniority the posting excludes, an injection attempt.
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
  // Only a keyword the resume does NOT have can be restated by a flag: one it
  // has is not a gap, so a flag naming it is about something else.
  const gaps = keywords.filter((k) => k.status !== 'present');
  const counted: string[] = [];
  const exempt: { flag: string; term: string }[] = [];
  for (const flag of flags) {
    const named = gaps.find((k) => matcher.findTerm(flag, k.term, k.aliases ?? []).length > 0);
    if (named) exempt.push({ flag, term: named.term });
    else counted.push(flag);
  }
  return { counted, exempt };
}
