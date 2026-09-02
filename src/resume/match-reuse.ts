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
}

/** reuse = show the row; suggest = the row lacks only suggestions; none = a new analysis. */
export type ReuseDecision = 'reuse' | 'suggest' | 'none';

export function reuseDecision(
  previous: StoredMatch | null,
  text: string,
  promptVersion: number,
  mode: MatchMode,
): ReuseDecision {
  if (previous === null || previous.promptVersion !== promptVersion || previous.resumeText !== text) return 'none';
  return previous.mode === 'full' || mode === 'fast' ? 'reuse' : 'suggest';
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
