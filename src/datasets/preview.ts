/*
 * What a set of mapped rows would cost before anything is stored: how many
 * the source already holds and how many of the new ones the running searches'
 * base filter lets through — each of those is one AI call when scoring is on.
 * Pure — tested in preview.test.ts.
 */

import { anyBaseFilterReason, type FilterProfile } from '../filter';
import { parseLocation } from '../location';
import type { NormalizedJob } from '../types';

export interface PreviewCounts {
  /** Rows that map to a job. */
  usable: number;
  /** Of those, the ones this source already holds. */
  stored: number;
  /** New rows a running search admits: what would be stored, and scored. */
  passing: number;
}

export function previewCounts(
  jobs: readonly NormalizedJob[],
  profiles: readonly FilterProfile[],
  storedIds: ReadonlySet<string>,
): PreviewCounts {
  const fresh = jobs.filter((job) => !storedIds.has(job.externalId));
  const passing = fresh.filter((job) => anyBaseFilterReason({ ...job, ...parseLocation(job.location, job.locationHints) }, profiles) === null);
  return { usable: jobs.length, stored: jobs.length - fresh.length, passing: passing.length };
}
