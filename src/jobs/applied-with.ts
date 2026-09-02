/**
 * "applied with Senior Backend v3" — the one phrase that names the resume an
 * application went out with. Pure so the stale digest (worker) and the job page
 * (dashboard) can print the same words without either importing the other.
 *
 * The version is part of the name on purpose: `Resume` rows are edited in
 * place, so "Senior Backend" alone stops being an answer the moment a new
 * version is uploaded.
 */

export interface AppliedResume {
  /** null when the resume row was deleted — the snapshot outlives it. */
  name: string | null;
  version: number | null;
}

/** A deleted resume still counts as an answer: we know it was sent, just not what it was called. */
const DELETED_LABEL = 'a deleted resume';

/**
 * Short label for the resume: `Senior Backend v3`. Null when nothing was
 * recorded — every caller then renders as it did before Stage C.
 */
export function appliedWithLabel(applied: AppliedResume | null): string | null {
  if (!applied) return null;
  const name = applied.name?.trim();
  if (!name && applied.version === null) return null;
  const label = name || DELETED_LABEL;
  return applied.version === null ? label : `${label} v${applied.version}`;
}
