import type { Span } from './keyword-matcher';
import type { MatchAction } from './prompts';

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
