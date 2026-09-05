import type { MatchMode } from './match-mode';

/*
 * When a stored comparison already answers a request (docs/target-plan.md
 * §3.1 item 3): the latest row for (job, resume) judged the identical text
 * under the same prompt. Plain string equality — a one-character edit is a
 * new analysis, and so is a prompt bump. This is what makes a double submit,
 * a back button or a re-paste free instead of a full resume-model call.
 *
 * Modes (ADR 0029): a full row answers any request; a fast row answers a
 * fast request, and a full request on top of it needs only the suggestions
 * call — never a second judgment of the same keywords.
 *
 * ResumeMatch has no prompt-version column; the version rides inside the
 * `breakdown` JSON (written by store.ts, read here). Rows from before that
 * marker read as null and are never reused.
 */

export interface StoredMatch {
  resumeText: string;
  promptVersion: number | null;
  mode: MatchMode;
  /** The verification a full row read its company context from; null = none stored, or a row from before the marker. */
  verificationId?: number | null;
}

/** reuse = show the row; suggest = the row lacks only suggestions; none = a new analysis. */
export type ReuseDecision = 'reuse' | 'suggest' | 'none';

export function reuseDecision(
  previous: StoredMatch | null,
  text: string,
  promptVersion: number,
  mode: MatchMode,
  /** The verification a full request would read now; a full row that read another one is stale for a full request (#162 stage 2). */
  verificationId: number | null = null,
): ReuseDecision {
  if (previous === null || previous.promptVersion !== promptVersion || previous.resumeText !== text) return 'none';
  if (mode === 'full' && previous.mode === 'full' && (previous.verificationId ?? null) !== verificationId) return 'none';
  return previous.mode === 'full' || mode === 'fast' ? 'reuse' : 'suggest';
}

/**
 * The newest rows judged on this same text, newest first, and the best of
 * them: a row to show beats a row that only lacks suggestions — a quick
 * check written after a full analysis of the same text (the editor's
 * re-check does that) must not cost a second suggestions call.
 */
export function pickReusable<T extends StoredMatch>(
  rows: T[],
  text: string,
  promptVersion: number,
  mode: MatchMode,
  verificationId: number | null = null,
): { row: T; decision: Exclude<ReuseDecision, 'none'> } | null {
  let suggest: T | null = null;
  for (const row of rows) {
    const decision = reuseDecision(row, text, promptVersion, mode, verificationId);
    if (decision === 'reuse') return { row, decision };
    if (decision === 'suggest' && suggest === null) suggest = row;
  }
  return suggest ? { row: suggest, decision: 'suggest' } : null;
}

/** The verification id a stored `breakdown` JSON carries, if any (full rows since v1.68.0). */
export function readVerificationId(breakdown: unknown): number | null {
  if (typeof breakdown !== 'object' || breakdown === null) return null;
  const v = (breakdown as { verificationId?: unknown }).verificationId;
  return Number.isInteger(v) ? (v as number) : null;
}

/** The prompt version a stored `breakdown` JSON carries, if any. */
export function readPromptVersion(breakdown: unknown): number | null {
  if (typeof breakdown !== 'object' || breakdown === null) return null;
  const v = (breakdown as { promptVersion?: unknown }).promptVersion;
  return Number.isInteger(v) ? (v as number) : null;
}

/** The flash shown instead of a run; `when` is the stored row's age ("3m ago"). */
export function reuseNotice(when: string): string {
  return `Unchanged since the last analysis (${when}) — showing that result; the resume model was not called again.`;
}

/** What the user is told when the suggestions call could not answer. */
export const SUGGESTIONS_FAILED =
  'The suggestions call failed — the quick check is still there. See the web logs.';

/**
 * The flash a finished suggestions call leaves. `reusedFrom` is the stored
 * quick check's age, given only by the "suggest" decision — there the user
 * asked for a full analysis and needs to know why the score did not move.
 * Pressing "Get suggestions" on a comparison already knows that.
 */
export function suggestionsFlash(counts: { actions: number; removals: number }, reusedFrom?: string): string {
  const kept = reusedFrom
    ? `The quick check from ${reusedFrom} judged this exact text, so its verdicts and score stand. `
    : '';
  return `${kept}Suggestions added — ${counts.actions} edits, ${counts.removals} removals; the score is unchanged.`;
}
