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

/**
 * Whose evidence a comparison may use beside the text it judges (TASKS R1):
 * `own` — the owner's confirmed facts and their other resumes, as always;
 * `text` — the text alone, for a file that may not be theirs (a friend's, an
 * old one): lent the owner's facts, it scored higher than it should.
 */
export type MatchEvidence = 'own' | 'text';

/** No marker is a row from before it, and every one of those used the owner's evidence. */
export function readMatchEvidence(breakdown: unknown): MatchEvidence {
  if (typeof breakdown !== 'object' || breakdown === null) return 'own';
  return (breakdown as { evidence?: unknown }).evidence === 'text' ? 'text' : 'own';
}

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
  meta: {
    promptVersion: number | null;
    mode: MatchMode;
    frame: FrameReason | null;
    /** The verification whose company context a full row read; null for a quick check or none stored (#162 stage 2). */
    verificationId: number | null;
    evidence: MatchEvidence;
  },
): Record<string, unknown> {
  return {
    ...bd,
    promptVersion: meta.promptVersion,
    mode: meta.mode,
    frame: meta.frame,
    verificationId: meta.verificationId,
    evidence: meta.evidence,
  };
}

/** The same JSON after suggestions were added — the row is now a full analysis, read with this verification's context. */
export function withSuggestionsMode(breakdown: unknown, verificationId: number | null): Record<string, unknown> {
  const base = typeof breakdown === 'object' && breakdown !== null ? (breakdown as Record<string, unknown>) : {};
  return { ...base, mode: 'full', verificationId };
}

/**
 * The comparison a cover letter takes its strengths from (#642). A quick
 * check carries none, and Save as vN scores the saved text as one — so the
 * letter written a minute after tailoring asked for suggestions again, while
 * the full report the edits came from sat one row below. The newest full
 * report of an earlier text of the SAME resume lends its strengths; the quick
 * check still gives the verdict and the keywords, which judged the text the
 * letter is written from. A one-off file's row lends nothing: its earlier
 * texts were other files. `earlier` is newest first; null = no strengths.
 */
export function strengthsReport<T extends { id: number; resumeId: number; strengths: string[]; breakdown: unknown }>(
  latest: T,
  earlier: readonly T[],
  oneOff: boolean,
): T | null {
  if (readMatchMode(latest.breakdown) === 'full') return latest;
  if (oneOff) return null;
  return earlier.find((m) => m.resumeId === latest.resumeId && m.id < latest.id && m.strengths.length > 0 && readMatchMode(m.breakdown) === 'full') ?? null;
}
