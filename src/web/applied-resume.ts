/*
 * "Which resume did I send?" — the three `Job` columns that answer it
 * (`appliedResumeId`, `appliedResumeVersion`, `appliedResumeText`) and the
 * rules for writing them (issues #74, #75).
 *
 * The text snapshot is the point: a resume's bytes are replaced in place on
 * "Upload a new version", so the id and the version alone would name v3 and
 * hand back v5's words. It was written from one route and read by none —
 * this module gives every write path the same rules and the page something
 * to show.
 *
 * Pure. The caller loads the resume; what counts as a recordable one, and
 * what an absent form field means, are decided here.
 */

/** What a form said about the applied resume. */
export type AppliedResumeChoice =
  | { kind: 'keep' }
  | { kind: 'clear' }
  | { kind: 'set'; id: number };

/**
 * A form field that is not there has said nothing — a page with no resume
 * picker must not silently erase what another page recorded. An empty value
 * is a real answer ("don't record one"), and so is an id.
 */
export function readAppliedResumeChoice(raw: unknown): AppliedResumeChoice {
  if (raw === undefined || raw === null) return { kind: 'keep' };
  const value = String(raw).trim();
  if (value.length === 0) return { kind: 'clear' };
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? { kind: 'set', id } : { kind: 'keep' };
}

export interface RecordableResume {
  id: number;
  version: number;
  text: string;
  /** The /target scratch row: replaced in place on every compare, never an application. */
  hidden: boolean;
}

export interface AppliedResumeColumns {
  appliedResumeId: number | null;
  appliedResumeVersion: number | null;
  appliedResumeText: string | null;
}

/**
 * The columns to write for a resolved resume. A resume that was deleted in
 * another tab, or the hidden scratch row, records nothing rather than
 * blocking the status change — "I don't know" is a true answer, a wrong id
 * is not.
 */
export function appliedResumeColumns(resume: RecordableResume | null): AppliedResumeColumns {
  if (!resume || resume.hidden) {
    return { appliedResumeId: null, appliedResumeVersion: null, appliedResumeText: null };
  }
  return {
    appliedResumeId: resume.id,
    appliedResumeVersion: resume.version,
    appliedResumeText: resume.text,
  };
}

/**
 * Whether to ask "which resume did you send?" — the job is in the funnel past
 * the point of applying, and nothing was recorded. That is the gap a card
 * dragged into Applied leaves behind: the board carries no picker, and
 * guessing on the user's behalf would state a fact they never gave.
 */
export function needsAppliedResume(job: {
  appliedResumeId: number | null;
  appliedAt: Date | null;
  pipelineStage: string | null;
  status: string;
}): boolean {
  if (job.appliedResumeId !== null) return false;
  return job.status === 'APPLIED' || job.appliedAt !== null || job.pipelineStage !== null;
}
