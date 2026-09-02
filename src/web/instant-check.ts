/*
 * Instant check (docs/target-plan.md §3.2 item 5): a re-uploaded resume is
 * parsed and shown as an unsaved draft over the latest analysis of the
 * posting — no AI call, no new version, nothing saved. The live estimate on
 * the page reads that analysis as its frame: the text confirms what is
 * `present`, while `add` / `ask_user` / `cannot_claim` stay the AI's verdict
 * on the resume it analysed, until "Re-analyze with AI" makes the draft
 * official. Pure — the routes decide what to fetch and where to redirect.
 */

/** The stored analysis a draft is checked against. */
export interface Frame {
  id: number;
  resumeText: string;
  createdAt: Date;
}

export type InstantDecision =
  /** Nothing to check against: the full analysis is the only option. */
  | { kind: 'analyze' }
  /** The file's text is the analysed text — the stored analysis already answers it. */
  | { kind: 'unchanged'; frame: Frame }
  /** New text: show it as a dirty draft over the frame. */
  | { kind: 'draft'; frame: Frame };

export function decideInstantCheck(frame: Frame | null, text: string): InstantDecision {
  if (!frame) return { kind: 'analyze' };
  return frame.resumeText === text ? { kind: 'unchanged', frame } : { kind: 'draft', frame };
}

/** The flash over a checked draft; `when` is the frame's age ("2h ago"). */
export function instantCheckNotice(filename: string, when: string, ms: number): string {
  return (
    `"${filename}" checked in ${ms} ms — no AI call. The estimate is measured against the analysis ` +
    `from ${when}: the text confirms what is present; add / confirm / can't-claim keep the AI's ` +
    `verdict on the analysed version until you Re-analyze.`
  );
}

export function unchangedNotice(filename: string, when: string): string {
  return `"${filename}" has the same text as the analysed version (${when}) — nothing new to check.`;
}

/** A stashed draft loads into the page only over the analysis it was checked against. */
export function draftTextForPage(
  stashed: { matchId: number; text: string } | null,
  matchId: number,
): string | null {
  return stashed && stashed.matchId === matchId ? stashed.text : null;
}
