/**
 * Confirm text for the two deletes that cascade (audit, TASKS §14). Pure so the
 * blast radius can be unit-tested rather than trusted.
 *
 * Deleting a resume takes every comparison, every cover letter — including the
 * ones the user edited by hand — and every strength review. Deleting a company
 * takes every job it posted, and with each job the application tracked against
 * it. Both wordings used to name only the obvious half.
 */

export interface DeleteImpact {
  matches: number;
  letters: number;
  reviews: number;
}

export function deleteConfirm(name: string, impact: DeleteImpact): string {
  const parts = [
    countOf(impact.matches, 'comparison', 'comparisons'),
    countOf(impact.letters, 'cover letter', 'cover letters'),
    countOf(impact.reviews, 'strength review', 'strength reviews'),
  ].filter((p): p is string => p !== null);

  if (parts.length === 0) return `Delete "${name}"? Nothing else is attached to it.`;
  return `Delete "${name}" and ${joinList(parts)}? This cannot be undone.`;
}

export interface CompanyDeleteImpact {
  jobs: number;
  /** Jobs in the funnel or marked applied — the rows that took real work. */
  applications: number;
  comparisons: number;
  letters: number;
}

/**
 * The confirm text for "Delete this company". Deleting one cascades every job
 * it ever posted, and a job carries the application you tracked, the
 * comparisons you ran and the letters you wrote (schema `onDelete: Cascade`).
 * The old wording counted the jobs only, so on real data "Delete Reddit and
 * all its 73 jobs?" was hiding six applications and a cover letter.
 */
export function companyDeleteConfirm(name: string, impact: CompanyDeleteImpact): string {
  const jobs = countOf(impact.jobs, 'job', 'jobs') ?? 'no jobs';
  const rest = [
    countOf(impact.applications, 'tracked application', 'tracked applications'),
    countOf(impact.comparisons, 'resume comparison', 'resume comparisons'),
    countOf(impact.letters, 'cover letter', 'cover letters'),
  ].filter((p): p is string => p !== null);
  if (rest.length === 0) return `Delete "${name}" and ${jobs}? This cannot be undone.`;
  return `Delete "${name}", ${jobs}, and with them ${joinList(rest)}? This cannot be undone.`;
}

function countOf(n: number, one: string, many: string): string | null {
  return n === 0 ? null : `${n} ${n === 1 ? one : many}`;
}

/** "a, b and c" — the last separator is a word, not another comma. */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
