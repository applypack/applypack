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
  // A keyword the resume does not have, or has only as a name on a skills line
  // — both are already priced, one by its zero credit and one by the suggestion
  // that puts it in a bullet. A keyword genuinely shown in the work is not a
  // gap, so a flag naming that one is about something else and counts.
  const gaps = keywords.filter((k) => k.status !== 'present' || k.evidence === 'listed');
  const counted: string[] = [];
  const exempt: { flag: string; term: string }[] = [];
  for (const flag of flags) {
    const named = gaps.find((k) => matcher.findTerm(flag, k.term, k.aliases ?? []).length > 0);
    if (named) exempt.push({ flag, term: named.term });
    else counted.push(flag);
  }
  return { counted, exempt };
}
