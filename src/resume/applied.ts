import type { KeywordMatcher, Span } from './keyword-matcher';
import type { MatchAction, MatchKeyword } from './prompts';

/*
 * What the candidate took from the last report, read off the text.
 *
 * Measured on one live pair over seven consecutive full analyses (job 2127,
 * matches 138–144): eleven of the later runs' quotes were the previous run's
 * own `replacement`, the current role's first bullet was rewritten in every
 * run — at 90 and at 100 — and a bullet added in run 4 was rewritten in runs
 * 5 and 6. Nothing in the prompt knew what it had proposed before: the
 * previous run's wording was just text to improve again.
 *
 * Two pure questions. `appliedWording` — which of the previous actions the
 * text now carries, located the way the editor locates a quote (exact, then
 * whitespace- and punctuation-insensitive). The prompt is handed those lines
 * as APPLIED FROM THE LAST RUN. `rewritesOfApplied` — which of the next
 * report's actions quote one of them: the churn metric, logged on every
 * analysis and the regression number for the prompt rule. The locator arrives
 * as an argument (target.mjs:locateQuote through the matcher).
 *
 * The prompt rule alone did not hold — measured with `npm run churn:compare`
 * on two pairs, two rounds each: rewrites of applied lines went from 11 of 18
 * actions to 6 of 12, and every survivor was "open the role with X instead"
 * about a bullet the model had written the round before. So `freshActions`
 * is the rule as code (the same move as gateRemovals, gotcha 11): a rework of
 * an applied line reaches the user only when it names a keyword the text does
 * not carry — a real gap the last wording lost — and is dropped otherwise.
 */

export type Locate = (text: string, quote: string | null | undefined) => Span | null;

/** Shorter than this is not wording, it is a term — and terms recur legitimately. */
const MIN_CHARS = 12;

export interface AppliedAction {
  action: MatchAction;
  /** The wording itself, as the prompt is handed it. */
  wording: string;
  /** Where it sits in the text now. */
  span: Span;
}

/** The previous report's actions whose wording the text carries. */
export function appliedWording(previous: MatchAction[], text: string, locate: Locate): AppliedAction[] {
  const out: AppliedAction[] = [];
  for (const action of previous) {
    const wording = action.replacement?.trim() ?? '';
    if (wording.length < MIN_CHARS) continue;
    const span = locate(text, wording);
    if (span) out.push({ action, wording, span });
  }
  return out;
}

/** The next report's actions that quote applied wording — a rewrite of what the candidate just took. */
export function rewritesOfApplied(
  applied: AppliedAction[],
  next: MatchAction[],
  text: string,
  locate: Locate,
): MatchAction[] {
  if (applied.length === 0) return [];
  return next.filter((a) => {
    const span = locate(text, a.quote);
    return span !== null && applied.some((p) => p.span.start < span.end && span.start < p.span.end);
  });
}

export interface FreshReport {
  /** What reaches the user. */
  kept: MatchAction[];
  /** Reworks of applied wording that named no missing keyword. */
  dropped: MatchAction[];
}

/**
 * The actions minus the reworks of applied wording — unless a rework names a
 * keyword the text does not carry (status other than `present`), which is the
 * one reason to touch a line the candidate just took. The keywords arrive
 * anchored to this text (keyword-anchor.ts), so `present` means written.
 */
export function freshActions(
  actions: MatchAction[],
  applied: AppliedAction[],
  keywords: Pick<MatchKeyword, 'term' | 'aliases' | 'status'>[],
  text: string,
  matcher: Pick<KeywordMatcher, 'findTerm' | 'locateQuote'>,
): FreshReport {
  const reworks = new Set(rewritesOfApplied(applied, actions, text, matcher.locateQuote));
  const missing = keywords.filter((k) => k.status !== 'present');
  const kept: MatchAction[] = [];
  const dropped: MatchAction[] = [];
  for (const a of actions) {
    const reason = `${a.why}\n${a.what}`;
    const namesGap = missing.some((k) => matcher.findTerm(reason, k.term, k.aliases ?? []).length > 0);
    (reworks.has(a) && !namesGap ? dropped : kept).push(a);
  }
  return { kept, dropped };
}

/** A wording a later suggestion rewrote is put back too, one step per pass. */
const MAX_PASSES = 4;

/**
 * The text as the candidate wrote it (#632): every wording a suggestion put in
 * goes back to the words it replaced, and an addition comes out. A cover
 * letter is checked against this, so a suggestion's wording is never its own
 * evidence — the letter once repeated a figure a summary rewrite had moved
 * onto other work, "fact-checked" against the very version that carried it.
 * What the person typed themselves (an edited wording included) stays: their
 * words are their claim. A wording that is part of what it replaced (a trim)
 * is left alone, or putting it back would find it again and grow forever.
 */
export function withoutSuggestedWording(text: string, actions: MatchAction[], locate: Locate): string {
  let out = text;
  const undone = new Set<MatchAction>();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const found = appliedWording(actions.filter((a) => !undone.has(a)), out, locate)
      .filter(({ action, wording }) => !action.quote || locate(action.quote, wording) === null)
      // Where two wordings overlap, the longer is the one the text carries: two
      // reports retitled one headline "Software Engineer, Backend" and "Senior
      // Software Engineer, Backend", and the shorter is only a piece of the other.
      .sort((a, b) => b.span.end - b.span.start - (a.span.end - a.span.start));
    const picked: AppliedAction[] = [];
    for (const f of found) {
      if (picked.every((p) => f.span.end <= p.span.start || p.span.end <= f.span.start)) picked.push(f);
    }
    let next = out;
    for (const { action, span } of picked.sort((a, b) => b.span.start - a.span.start)) {
      const back = action.quote ?? '';
      // An addition was a line of its own: it goes with its line break.
      const end = back === '' && next[span.end] === '\n' ? span.end + 1 : span.end;
      next = `${next.slice(0, span.start)}${back}${next.slice(end)}`;
      undone.add(action);
    }
    if (next === out) break;
    out = next;
  }
  return out;
}
