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
 * The other half of the same idea, pointed at the RESUME (ADR 0045; the
 * present/add half came with the ADR 0044 addendum).
 *
 * Whether a word is in the text is a question the matcher can answer, and the
 * model's answer to it drifts: the same TypeScript in the same resume was
 * called `present` in one run and `add` in the next, which is how a comparison
 * scored 79 and then 30; the same WordPress, on the resume's own title line,
 * was called `cannot_claim` ("no WordPress work anywhere in resume"), and the
 * primary-stack cap held that comparison at 41 while a count of the same text
 * says 52. So the text settles the status, for every verdict:
 *
 *  - a term the matcher CAN find is `present`, whatever the model said. An
 *    `add` that is written is not "unwritten"; an `ask_user` the text answers
 *    is not a question (left alone, that one cost a live comparison 49
 *    points, and the confirm card asked about a word already on the page);
 *    and a `cannot_claim` the resume spells is a claim the resume makes —
 *    how thinly is `evidence`'s answer (listed / described / measured), which
 *    is where "named, but nothing behind it" belongs. A stored denial does not
 *    outrank the text either: facts.ts already lets a written word stand over
 *    a stale "no". The known cost is a homonym — on the live corpus 29 of the
 *    1 215 `cannot_claim` rows were written, 8 of them "GCP" meaning Good
 *    Clinical Practice on an engineer's resume, every one on a comparison
 *    scoring 0 anyway.
 *  - a `present` the matcher cannot find is `add`: a paraphrase — "automated
 *    testing" against "Unit, integration & E2E testing" — so the claim behind
 *    it stands and the word does not. 5 of 137 present keywords on the corpus.
 *  - an unwritten `add`, `ask_user` or `cannot_claim` stays what it is.
 *
 * `score.mjs:entriesFromLive` applies the same rules in the browser, so the
 * number under the editor is this score on the text as typed — before this,
 * the table said matched while the chip offered to add the same term, and a
 * typed word the model had not backed moved nothing until the next analysis.
 */
export function anchorStatuses(
  keywords: MatchKeyword[],
  resumeText: string,
  matcher: KeywordMatcher,
): { keywords: MatchKeyword[]; downgraded: number; upgraded: number } {
  let downgraded = 0;
  let upgraded = 0;
  const next = keywords.map((k) => {
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
