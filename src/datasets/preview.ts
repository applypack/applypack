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
  /** New rows a running search admits but whose company is muted, or was applied to inside the re-apply window (ADR 0056). */
  turnedAway: number;
  /** New rows that would be stored, and scored. */
  passing: number;
}

/**
 * The tick's own order (process-jobs.ts): the base filter, then who hires,
 * then what is already stored. `turnsAway` is the employer gate, handed in
 * so this stays pure; a row the source already holds is set aside first here,
 * which changes no total — a stored row is never scored either way.
 */
export function previewCounts(
  jobs: readonly NormalizedJob[],
  profiles: readonly FilterProfile[],
  storedIds: ReadonlySet<string>,
  turnsAway: (job: NormalizedJob) => boolean = () => false,
): PreviewCounts {
  const fresh = jobs.filter((job) => !storedIds.has(job.externalId));
  const admitted = fresh.filter((job) => anyBaseFilterReason({ ...job, ...parseLocation(job.location, job.locationHints) }, profiles) === null);
  const turnedAway = admitted.filter(turnsAway).length;
  return { usable: jobs.length, stored: jobs.length - fresh.length, turnedAway, passing: admitted.length - turnedAway };
}
