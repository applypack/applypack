import type { AtsType, Job } from '@prisma/client';
import { logger } from '../logger';
import { classifyJob } from '../classifier';
import { listActiveProfiles } from '../profiles';
import { isBlankProfile } from '../profile-guards';
import { getSettings } from '../settings';
import { buildVerdicts, mergeVerdicts } from './verdict-merge';
import { saveJobScores } from './score-store';
import { mergeAiLocation, type StoredPlace } from './location-merge';
import { handPickedSource, statusAfterRescore } from './rescore-status';

/** `sourceConfig` rides along because a folder of saved postings is told from a folder of rows by it (rescore-status.ts). */
export type ClassifiableJob = Job & { company: { name: string; atsType: AtsType; sourceConfig: unknown } };

/**
 * Classifies one stored job against every active search and writes the scores
 * back (ADR 0028). Used by the per-job "Re-classify" button and by manual job
 * entry. With `keepStatus` the row's status is left alone; otherwise
 * `statusAfterRescore` decides: a job is dismissed only when EVERY search
 * rejects it, and never when it is Applied, Saved, or a posting the user
 * pasted or saved as a file — a dismissed row is deleted a month on.
 * Returns false when no search is active or the classifier failed.
 */
export async function classifyExistingJob(
  job: ClassifiableJob,
  opts: { keepStatus: boolean },
): Promise<boolean> {
  const started = Date.now();
  // Blank searches are dropped here exactly as in the tick and in
  // "Re-classify all" (issue #50) — otherwise this path, and only this path,
  // would store a vibes-based verdict next to the real ones.
  const profiles = (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
  if (profiles.length === 0) {
    logger.warn({ jobId: job.id }, 'classify-existing: no usable active search');
    return false;
  }
  const { classifierMode } = await getSettings();
  const outcome = await classifyJob(
    {
      title: job.title,
      companyName: job.employer ?? job.company.name,
      location: job.location,
      place: { workplace: job.workplace, countries: job.countries, regions: job.regions },
      description: job.description,
      postedAt: job.postedAt,
    },
    profiles,
    classifierMode,
  );
  if (outcome.results.size === 0) return false;

  const { verdicts } = buildVerdicts(outcome.results, profiles, job);
  const merged = mergeVerdicts(verdicts);
  if (!merged) return false;

  const status = opts.keepStatus ? job.status : statusAfterRescore(job.status, merged.kept, handPickedSource(job.company));

  await saveJobScores(job, merged, verdicts, status, mergeAiLocation(storedPlace(job), outcome.location));
  logger.info(
    { jobId: job.id, searches: profiles.length, kept: merged.kept, ms: Date.now() - started },
    'classify-existing: scored',
  );
  return true;
}

/** The row's own columns as the merge's starting point (ADR 0031 wrote them). */
export function storedPlace(job: Pick<Job, 'workplace' | 'countries' | 'regions' | 'locationSource'>): StoredPlace {
  return {
    workplace: job.workplace,
    countries: job.countries,
    regions: job.regions,
    source: job.locationSource as StoredPlace['source'],
  };
}

/**
 * The same call with nobody waiting on it — for a pasted posting whose
 * reader wants the comparison, not the fit score. The score lands on the job
 * page whenever the classifier answers; a failure is logged, never surfaced.
 */
export function classifyInBackground(job: ClassifiableJob): void {
  void classifyExistingJob(job, { keepStatus: true }).catch((err) => {
    logger.error({ err, jobId: job.id }, 'classify-existing: background run failed');
  });
}
