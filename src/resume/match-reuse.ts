import type { MatchEvidence, MatchMode } from './match-mode';
import { t } from '../i18n/t';

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
  /** Whose evidence it used (R1): a text-only judgment never answers for one with the owner's facts, or back. */
  evidence?: MatchEvidence;
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
  evidence: MatchEvidence = 'own',
): ReuseDecision {
  if (previous === null || previous.promptVersion !== promptVersion || previous.resumeText !== text) return 'none';
  if ((previous.evidence ?? 'own') !== evidence) return 'none';
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
  evidence: MatchEvidence = 'own',
): { row: T; decision: Exclude<ReuseDecision, 'none'> } | null {
  let suggest: T | null = null;
  for (const row of rows) {
    const decision = reuseDecision(row, text, promptVersion, mode, verificationId, evidence);
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
  return t('match.reuse.notice', { when });
}

/** What the user is told when the suggestions call could not answer; `reason` is the engine's own words. */
export function suggestionsFailed(reason?: string): string {
  return reason ? t('match.suggestions.failedWith', { reason }) : t('match.suggestions.failed');
}

/**
 * The flash a finished suggestions call leaves. `reusedFrom` is the stored
 * quick check's age, given only by the "suggest" decision — there the user
 * asked for a full analysis and needs to know why the score did not move.
 * Pressing "Get suggestions" on a comparison already knows that.
 */
export function suggestionsFlash(counts: { actions: number; removals: number }, reusedFrom?: string): string {
  return reusedFrom
    ? t('match.suggestions.addedReused', { ...counts, when: reusedFrom })
    : t('match.suggestions.added', counts);
}
