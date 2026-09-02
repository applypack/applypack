import { AtsType, JobStatus, type Job } from '@prisma/client';
import { logger } from '../logger';
import { classifyJob } from '../classifier';
import { listActiveProfiles } from '../profiles';
import { isBlankProfile } from '../profile-guards';
import { getSettings } from '../settings';
import { buildVerdicts, mergeVerdicts } from './verdict-merge';
import { saveJobScores } from './score-store';

/**
 * Classifies one stored job against every active search and writes the scores
 * back (ADR 0028). Used by the per-job "Re-classify" button and by manual job
 * entry. With `keepStatus` the row's status is left alone (a pasted job the
 * user cares about must not be auto-dismissed); otherwise the same
 * promote/demote rules as the fetch tick apply — a job is dismissed only when
 * EVERY search rejects it — except APPLIED, which is sealed.
 * Returns false when no search is active or the classifier failed.
 */
export async function classifyExistingJob(
  job: Job & { company: { name: string; atsType: AtsType } },
  opts: { keepStatus: boolean },
): Promise<boolean> {
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
      companyName: job.company.name,
      location: job.location,
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

  let status = job.status;
  if (!opts.keepStatus && job.status !== JobStatus.APPLIED) {
    if (!merged.kept) status = JobStatus.DISMISSED;
    else if (job.status === JobStatus.DISMISSED) status = JobStatus.NEW;
  }

  await saveJobScores(job, merged, verdicts, status);
  return true;
}
