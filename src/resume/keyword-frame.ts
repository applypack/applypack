/*
 * Which keyword frame a comparison runs with (docs/target-plan.md §4 F7,
 * issue #79). CONSISTENCY ACROSS RUNS freezes the term list per posting so a
 * better resume shows up as a better number — the flip side is that a term the
 * model missed on run 1 stays missed on every run after it. Two ways out of a
 * bad frame, both decided here and nowhere else:
 *
 * - "Rebuild keywords" — the user says this frame is wrong: run once without
 *   it and let the model read the posting again.
 * - A prompt bump — a frame extracted under rules the current prompt no
 *   longer follows is never inherited, or the bump would keep re-deriving the
 *   old prompt's list.
 * - A changed posting — the description was replaced with the company's own
 *   listing (or restored) after the frame was read (ADR 0043): the terms came
 *   from text this posting no longer shows.
 *
 * Only the MODEL's frame is dropped. The user's overrides — re-levelled,
 * ignored and hand-added terms — are re-applied by carryOverrides from the
 * full stored list rather than from the frame, so they survive both cases: a
 * rebuild resets the machine's guess, never the person's decision.
 *
 * Pure — tested in keyword-frame.test.ts. The reason is stored in the
 * breakdown JSON (no schema change, the same trick as the mode marker of
 * ADR 0029) so the card can say why a score stands on its own.
 */

const FRAME_REASONS = ['carried', 'first-run', 'rebuild', 'prompt-bump', 'posting-changed'] as const;
export type FrameReason = (typeof FRAME_REASONS)[number];

/** The latest stored analysis of this posting, as the frame decision reads it. */
export interface StoredFrame {
  /** How many keywords it holds — an empty list is nothing to inherit. */
  terms: number;
  /** The prompt that wrote them; null on rows older than the marker. */
  promptVersion: number | null;
}

export interface FramePlan {
  /** Whether PREVIOUS KEYWORDS goes into the prompt at all. */
  carry: boolean;
  reason: FrameReason;
}

export function planKeywordFrame(
  stored: StoredFrame | null,
  promptVersion: number,
  rebuild: boolean,
  /** The stored frame was read from a description this posting has since replaced (ADR 0043). */
  postingChanged = false,
): FramePlan {
  if (stored === null || stored.terms === 0) return { carry: false, reason: 'first-run' };
  if (rebuild) return { carry: false, reason: 'rebuild' };
  if (postingChanged) return { carry: false, reason: 'posting-changed' };
  // Any other version, not just an older one: a downgrade inherits a frame
  // written by rules this prompt does not have either, and a pre-marker row
  // (null) cannot say which rules it followed at all.
  if (stored.promptVersion !== promptVersion) return { carry: false, reason: 'prompt-bump' };
  return { carry: true, reason: 'carried' };
}

/** The stored marker; null on rows written before it existed. */
export function readFrameReason(breakdown: unknown): FrameReason | null {
  if (typeof breakdown !== 'object' || breakdown === null) return null;
  const v = (breakdown as { frame?: unknown }).frame;
  return FRAME_REASONS.includes(v as FrameReason) ? (v as FrameReason) : null;
}

/**
 * Why this row's score cannot be read against the one before it: its terms were
 * extracted afresh, so the two numbers count different things. A first run has
 * nothing to be compared with, and a carried frame is what makes the comparison
 * fair in the first place — neither says anything here.
 */
export type FreshFrameReason = Exclude<FrameReason, 'carried' | 'first-run'>;

export function freshFrame(breakdown: unknown): FreshFrameReason | null {
  const reason = readFrameReason(breakdown);
  return reason === 'carried' || reason === 'first-run' || reason === null ? null : reason;
}

/** What the card says in place of the version delta. */
export function freshFrameNotice(reason: FreshFrameReason): string {
  const why =
    reason === 'rebuild'
      ? 'Keywords were rebuilt from the posting for this run'
      : reason === 'posting-changed'
        ? "The posting's description was replaced after the earlier analysis, so its keywords were read afresh"
        : 'The analysis prompt changed, so the earlier keywords were not reused';
  return `${why}, so this analysis counts a different set of terms. Read the score on its own — the earlier ones judged another list.`;
}
