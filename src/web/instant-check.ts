/*
 * Instant check (docs/target-plan.md §3.2 item 5, revisited by #184): a
 * re-uploaded resume is parsed and shown as an unsaved draft over the latest
 * analysis of the posting within a second — no new version, nothing saved —
 * while the quick AI check of the same text runs behind it (draft-check.ts)
 * and lands beside the score. Until then the live estimate reads the frame
 * analysis: the text confirms what is `present`, while `add` / `ask_user` /
 * `cannot_claim` stay the AI's verdict on the resume it analysed. Pure — the
 * routes decide what to fetch and where to redirect.
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

/** The flash over the draft while its AI check runs behind it (#184). */
export function instantCheckNotice(filename: string, ms: number): string {
  return (
    `"${filename}" opened in the editor in ${ms} ms. The estimate below is measured against the last ` +
    `analysis; the AI check of this text runs in the background and its number lands beside the score.`
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
