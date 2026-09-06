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
 *  - `ask_user` the matcher CAN find becomes `present` too. `ask_user` means
 *    "this resume does not evidence it, but the candidate might" — a premise
 *    the text refutes. Left alone it cost a live comparison 49 points: the
 *    resume says TypeScript in its skills line, one run called it `present`
 *    (score 53) and the next `ask_user` (score 30, the whole primary stack
 *    reading as absent), and the confirm card asked the candidate about a word
 *    they had already written.
 *
 * `cannot_claim` is NEVER upgraded, whatever the text says. It is the status a
 * user's own denial produces (facts.ts runs before this), and a denial outranks
 * a word on a page. It is also the honest answer when a term is named but the
 * model judged the resume cannot stand behind it — `evidence: listed` is where
 * that shows now.
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
    if (k.status === 'cannot_claim') return k;
    const written = matcher.findTerm(resumeText, k.term, k.aliases).length > 0;
    if (written === (k.status === 'present')) return k;
    if (written) {
      upgraded++;
      return { ...k, status: 'present' as const };
    }
    // Only a `present` can be wrong in the other direction: an `ask_user` the
    // text does not carry is exactly what `ask_user` is for.
    if (k.status !== 'present') return k;
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
