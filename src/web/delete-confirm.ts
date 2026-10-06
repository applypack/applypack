import { DELETED_LABEL } from '../jobs/applied-with';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

/**
 * Confirm text for the two deletes that cascade (audit, TASKS §14). Pure so the
 * blast radius can be unit-tested rather than trusted.
 *
 * Deleting a resume takes every comparison, every cover letter — including the
 * ones the user edited by hand — and every strength review. Deleting a company
 * takes every job it posted, and with each job the application tracked against
 * it. Both wordings used to name only the obvious half.
 *
 * A resume also has two SetNull dependants that neither deletes nor survives
 * unchanged — the search that hunts with it and the applications it went out
 * with. Those are named too, in a clause of their own.
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
  const deleted = joinList([
    countOf(impact.matches, 'profile.deleteConfirm.part.comparisons'),
    countOf(impact.letters, 'profile.deleteConfirm.part.letters'),
    countOf(impact.reviews, 'profile.deleteConfirm.part.reviews'),
  ]);
  const unlinked = joinList([
    countOf(impact.searches, 'profile.deleteConfirm.part.searchesStop'),
    // The words the applications will show are another module's: they go in as they are.
    impact.applications === 0 ? null : t('profile.deleteConfirm.part.applicationsShow', { n: impact.applications, label: DELETED_LABEL }),
  ]);

  // One sentence per shape: what goes with the resume belongs in the question, what only loses its link after it.
  if (deleted === '' && unlinked === '') return t('profile.deleteConfirm.resume.nothingAttached', { name });
  if (deleted === '') return t('profile.deleteConfirm.resume.plain', { name, unlinked });
  if (unlinked === '') return t('profile.deleteConfirm.resume.withDeleted', { name, deleted });
  return t('profile.deleteConfirm.resume.withBoth', { name, deleted, unlinked });
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
  const rest = joinList([
    countOf(impact.applications, 'profile.deleteConfirm.part.trackedApplications'),
    countOf(impact.comparisons, 'profile.deleteConfirm.part.resumeComparisons'),
    countOf(impact.letters, 'profile.deleteConfirm.part.letters'),
  ]);
  if (rest === '') return t('profile.deleteConfirm.company.jobs', { name, jobs: impact.jobs });
  return t('profile.deleteConfirm.company.jobsAndMore', { name, jobs: impact.jobs, rest });
}

/** "12 comparisons" by the count's own plural, or null when there are none to name. */
function countOf(n: number, key: MessageKey): string | null {
  return n === 0 ? null : t(key, { n });
}

/**
 * "a, b and c" — the last separator is a word, not another comma. The word is
 * the catalog's; `formatList` would write the English with a comma before it.
 */
function joinList(parts: (string | null)[]): string {
  const named = parts.filter((p): p is string => p !== null);
  if (named.length <= 1) return named[0] ?? '';
  return t('profile.deleteConfirm.and', { head: named.slice(0, -1).join(', '), last: named[named.length - 1]! });
}
