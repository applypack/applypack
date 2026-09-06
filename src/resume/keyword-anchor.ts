import { canonicalTerm } from './facts';
import { aliasesFor } from './keyword-aliases';
import type { KeywordMatcher } from './keyword-matcher';
import type { MatchKeyword } from './prompts';

/*
 * Persist-time verbatim guard (target-plan.md §4 F2). The prompt wants every
 * keyword copied character-for-character from the posting because the panes
 * highlight by literal search; when the model paraphrases anyway, the row
 * sits in the table and highlights nowhere. This pass runs the matcher over
 * the posting: a keyword with no span is re-anchored to the longest verbatim
 * phrase of itself (two or more of its words in a row) the posting does
 * contain — the term becomes that phrase, spelled as the posting spells it —
 * and one with none is marked `unanchored`, so the UI can say so and the log
 * can count it: the regression metric for every PROMPT_VERSION bump. Pure —
 * the matcher comes in as an argument.
 */

const WORD_BOUNDARY = /[^\p{L}\p{N}+#.]+/u;

export interface AnchorReport {
  keywords: MatchKeyword[];
  /** Terms rewritten to a verbatim phrase of the posting. */
  anchored: number;
  /** Terms the posting contains in no recognisable form. */
  unanchored: number;
}

/**
 * The other half of the same idea, pointed at the RESUME (ADR 0044 addendum).
 * "present" is the one status the browser re-checks on every keystroke: the
 * live estimate credits a term by finding it in the text, and the missing-chips
 * row is exactly the terms it could not find. So a keyword the model called
 * present and the matcher cannot see makes the page contradict itself — the
 * table says matched, the chip above the editor offers to add it, and the two
 * scores drift apart for a reason no user can discover.
 *
 * Measured on the live corpus: 5 of 137 present keywords (4%). Each one was a
 * paraphrase — "automated testing" against a resume that says "Unit,
 * integration & E2E testing", "5+ years of experience" against "12+ years".
 * The claim behind them is fine; the word is not there. That is exactly what
 * `add` means, so they become `add`, keep their half credit and their note, and
 * the "+ add" chip they now get is the correct advice.
 */
export function anchorStatuses(
  keywords: MatchKeyword[],
  resumeText: string,
  matcher: KeywordMatcher,
): { keywords: MatchKeyword[]; downgraded: number } {
  let downgraded = 0;
  const next = keywords.map((k) => {
    if (k.status !== 'present') return k;
    if (matcher.findTerm(resumeText, k.term, k.aliases).length > 0) return k;
    downgraded++;
    return { ...k, status: 'add' as const };
  });
  return { keywords: next, downgraded };
}

export function anchorKeywords(
  keywords: MatchKeyword[],
  posting: string,
  matcher: KeywordMatcher,
): AnchorReport {
  const taken = new Set(keywords.map((k) => canonicalTerm(k.term)));
  let anchored = 0;
  let unanchored = 0;
  const next = keywords.map((k) => {
    if (matcher.findTerm(posting, k.term, k.aliases).length > 0) return k;
    const phrase = longestVerbatimPhrase(k.term, posting, matcher);
    // A phrase another row already owns would make two rows of one keyword.
    if (phrase !== null && !taken.has(canonicalTerm(phrase))) {
      taken.add(canonicalTerm(phrase));
      anchored++;
      return { ...k, term: phrase };
    }
    unanchored++;
    return { ...k, unanchored: true };
  });
  return { keywords: next, anchored, unanchored };
}

/** The longest run of two or more consecutive words of `term` the posting contains, as the posting spells it. */
function longestVerbatimPhrase(term: string, posting: string, matcher: KeywordMatcher): string | null {
  const words = term.split(WORD_BOUNDARY).filter((w) => /[\p{L}\p{N}]/u.test(w));
  for (let length = words.length; length >= 2; length--) {
    for (let start = 0; start + length <= words.length; start++) {
      const [span] = matcher.findTerm(posting, words.slice(start, start + length).join(' '));
      if (span) return posting.slice(span.start, span.end).replace(/\s+/g, ' ');
    }
  }
  return null;
}

/**
 * The other-resume hints this posting can use. A skill the posting never
 * names cannot become one of its keywords, and with four resumes stored the
 * full list ran to 122 fenced lines on every call (#159). annotateElsewhere
 * still reads the whole list — it annotates terms the model returned.
 */
export function elsewhereForPosting<S extends { skill: string }>(
  otherSkills: S[],
  posting: string,
  matcher: Pick<KeywordMatcher, 'findTerm'>,
): S[] {
  return otherSkills.filter((s) => matcher.findTerm(posting, s.skill, aliasesFor(s.skill)).length > 0);
}
