import type { FrameReason } from './keyword-frame';
import type { ScoreBreakdown } from './score';

/*
 * The two shapes a stored comparison can have (ADR 0029): a "fast" row holds
 * the score-complete subset — keywords, alignment, gates, red flags, summary —
 * and a "full" row also carries the edit suggestions (actions, removals,
 * strengths, cautions). The marker rides inside the `breakdown` JSON next to
 * the prompt version, so no schema change; rows written before the marker
 * were all full analyses. Pure — tested in match-mode.test.ts.
 */

export const MATCH_MODES = ['fast', 'full'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

/** A form value → mode; anything unrecognised is the quick check. */
export function parseMatchMode(v: unknown): MatchMode {
  return v === 'full' ? 'full' : 'fast';
}

/** Mode of a stored row; no marker means the row predates it and carried suggestions. */
export function readMatchMode(breakdown: unknown): MatchMode {
  if (typeof breakdown !== 'object' || breakdown === null) return 'full';
  return (breakdown as { mode?: unknown }).mode === 'fast' ? 'fast' : 'full';
}

/**
 * What store.ts writes into the JSON column: the score parts plus the three
 * markers. Every field is required, so the compiler names any write that would
 * drop one — a re-score that forgets `frame` would silently make an
 * incomparable score look comparable again.
 */
export function storedBreakdown(
  bd: ScoreBreakdown,
  meta: { promptVersion: number | null; mode: MatchMode; frame: FrameReason | null },
): Record<string, unknown> {
  return { ...bd, promptVersion: meta.promptVersion, mode: meta.mode, frame: meta.frame };
}

/** The same JSON after suggestions were added — the row is now a full analysis. */
export function withSuggestionsMode(breakdown: unknown): Record<string, unknown> {
  const base = typeof breakdown === 'object' && breakdown !== null ? (breakdown as Record<string, unknown>) : {};
  return { ...base, mode: 'full' };
}
