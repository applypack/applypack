import { AtsType, JobStatus, type Job } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { classifyJob } from '../classifier';
import { getActiveProfile } from '../profiles';
import { getSettings } from '../settings';
import { parsePriorityRules } from '../priority-rules';
import { applyPriorityFloor } from './process-jobs';
import { withApplyLinkFlags } from '../apply-link';

/**
 * Classifies one stored job against the active profile and writes the
 * scores back. Used by the per-job "Re-classify" button and by manual job
 * entry. With `keepStatus` the row's status is left alone (a pasted job the
 * user cares about must not be auto-dismissed); otherwise the same
 * promote/demote rules as the fetch tick apply, except APPLIED is sealed.
 * Returns false when there is no active profile or the classifier failed.
 */
export async function classifyExistingJob(
  job: Job & { company: { name: string; atsType: AtsType } },
  opts: { keepStatus: boolean },
): Promise<boolean> {
  const profile = await getActiveProfile();
  if (!profile) {
    logger.warn({ jobId: job.id }, 'classify-existing: no active profile');
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
    profile,
    classifierMode,
  );
  if (!outcome.result) return false;

  const priority = applyPriorityFloor(outcome.result, parsePriorityRules(profile.priorityRules), job);
  const c = priority.classification;

  let status = job.status;
  if (!opts.keepStatus && job.status !== JobStatus.APPLIED) {
    const failsFit = c.fit_score < profile.minFitScore;
    const failsLocation = !c.location_match;
    const failsSalary =
      profile.minSalaryUsd > 0 &&
      c.salary_min_usd !== null &&
      c.salary_min_usd > 0 &&
      c.salary_min_usd < profile.minSalaryUsd;
    if (failsFit || failsLocation || failsSalary) status = JobStatus.DISMISSED;
    else if (job.status === JobStatus.DISMISSED) status = JobStatus.NEW;
  }

  await prisma.job.update({
    where: { id: job.id },
    data: {
      fitScore: c.fit_score,
      salaryMin: c.salary_min_usd,
      salaryMax: c.salary_max_usd,
      techMatch: c.tech_match,
      redFlags: withApplyLinkFlags(c.red_flags, {
        url: job.url,
        pasted: job.company.atsType === AtsType.MANUAL,
      }),
      summary: c.summary,
      status,
      priorityRulesApplied: priority.applied.map((r) => r.label),
    },
  });
  return true;
}
