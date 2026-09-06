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
 *
 * `present` and `add` differ on ONE question — is the word in the text? — and
 * that question has an answer the matcher can give. The model's answer to it
 * drifts: the same TypeScript in the same resume was called `present` in one
 * run and `add` in the next, which is how a comparison ended up scoring 79 and
 * then 30. The two statuses are therefore settled here, both ways:
 *
 *  - `present` the matcher cannot find becomes `add`. It is a paraphrase —
 *    "automated testing" against a resume that says "Unit, integration & E2E
 *    testing" — so the claim behind it stands and the word does not. 5 of 137
 *    present keywords on the live corpus.
 *  - `add` the matcher CAN find becomes `present`. `add` means "evidenced but
 *    unwritten"; if the word is written, it is not that.
 *
 * `ask_user` and `cannot_claim` are never touched: those are claims about what
 * the candidate HAS, and no amount of typing makes one true.
 *
 * Without this, the table said matched while the chip above the editor offered
 * to add the same term, and the live estimate scored it zero.
 */
export function anchorStatuses(
  keywords: MatchKeyword[],
  resumeText: string,
  matcher: KeywordMatcher,
): { keywords: MatchKeyword[]; downgraded: number; upgraded: number } {
  let downgraded = 0;
  let upgraded = 0;
  const next = keywords.map((k) => {
    if (k.status !== 'present' && k.status !== 'add') return k;
    const written = matcher.findTerm(resumeText, k.term, k.aliases).length > 0;
    if (written === (k.status === 'present')) return k;
    if (written) {
      upgraded++;
      return { ...k, status: 'present' as const };
    }
    downgraded++;
    return { ...k, status: 'add' as const };
  });
  return { keywords: next, downgraded, upgraded };
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
