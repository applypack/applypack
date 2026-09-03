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
  /** Searches hunting with this resume. SetNull: the search lives on, unlinked. */
  searches: number;
  /** Applications that recorded it as the resume they went out with. */
  applications: number;
}

/**
 * Two clauses, because a resume has two kinds of dependant. The Cascade
 * children are deleted with it and belong in the question. The SetNull ones
 * survive with a link cleared — a search that loses its resume goes back to
 * guessing by skill overlap (`resume/pick.ts`), and an application keeps its
 * text snapshot but loses the name (`jobs/applied-with.ts`). Listing those
 * alongside the deletions would claim the search is deleted too, which is the
 * opposite of what happens, so they get a sentence of their own.
 */
export function deleteConfirm(name: string, impact: DeleteImpact): string {
  const deleted = [
    countOf(impact.matches, 'comparison', 'comparisons'),
    countOf(impact.letters, 'cover letter', 'cover letters'),
    countOf(impact.reviews, 'strength review', 'strength reviews'),
  ].filter((p): p is string => p !== null);

  const unlinked = [
    impact.searches === 0
      ? null
      : `${impact.searches} ${impact.searches === 1 ? 'search stops' : 'searches stop'} hunting with it`,
    impact.applications === 0
      ? null
      : `${impact.applications} ${impact.applications === 1 ? 'application' : 'applications'} will show "a deleted resume" instead`,
  ].filter((p): p is string => p !== null);

  if (deleted.length === 0 && unlinked.length === 0) {
    return `Delete "${name}"? Nothing else is attached to it.`;
  }
  const head =
    deleted.length === 0 ? `Delete "${name}"?` : `Delete "${name}" and ${joinList(deleted)}?`;
  const side = unlinked.length === 0 ? '' : ` ${joinList(unlinked)}.`;
  return `${head}${side} This cannot be undone.`;
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
