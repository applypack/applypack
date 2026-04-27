import { JobStatus, type Prisma, type Profile } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { passesBaseFilter } from '../filter';
import { classifyJob } from '../classifier';
import { sendTelegramAlert } from '../notifier';
import type {
  ClaudeClassification,
  ClassifyInput,
  NormalizedJob,
} from '../types';

export interface FetchResult {
  job: NormalizedJob;
  companyName: string;
}

export interface ProcessStats {
  filterRejected: number;
  duplicate: number;
  preFiltered: number;
  classified: number;
  classifyFailed: number;
  persisted: number;
  dismissed: number;
  alerted: number;
  alertFailed: number;
}

/**
 * Shared inner loop used by runFetchJob and runHnHiringJob: filter, dedupe,
 * classify, persist, alert. Mutates `stats` in place so the caller can
 * decorate it with extra fields (profile name, durationMs, etc.).
 */
export async function processNormalizedJobs(
  items: FetchResult[],
  profile: Profile,
  classifierMode: 'single' | 'two_stage',
  stats: ProcessStats,
): Promise<void> {
  for (const { job, companyName } of items) {
    if (!passesBaseFilter(job, profile)) {
      stats.filterRejected++;
      continue;
    }

    const existing = await prisma.job.findUnique({
      where: {
        companyId_externalId: {
          companyId: job.companyId,
          externalId: job.externalId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      stats.duplicate++;
      continue;
    }

    const outcome = await classifyJob(
      buildClassifyInput(job, companyName),
      profile,
      classifierMode,
    );
    if (outcome.preFiltered) {
      stats.preFiltered++;
      continue;
    }
    const classification = outcome.result;
    if (!classification) {
      stats.classifyFailed++;
      continue;
    }
    stats.classified++;

    const dismissReason = decideDismissReason(classification, profile);
    if (dismissReason) {
      await prisma.job.create({
        data: buildJobData(job, classification, JobStatus.DISMISSED),
      });
      stats.persisted++;
      stats.dismissed++;
      logger.debug(
        {
          title: job.title,
          companyName,
          fitScore: classification.fit_score,
          reason: dismissReason,
        },
        'process-jobs: dismissed',
      );
      continue;
    }

    const created = await prisma.job.create({
      data: buildJobData(job, classification, JobStatus.NEW),
    });
    stats.persisted++;

    try {
      await sendTelegramAlert(
        {
          title: created.title,
          companyName,
          location: created.location,
          url: created.url,
          fitScore: created.fitScore ?? classification.fit_score,
          salaryMin: created.salaryMin,
          salaryMax: created.salaryMax,
          techMatch: created.techMatch,
          redFlags: created.redFlags,
          summary: created.summary ?? '',
        },
        profile,
      );
      await prisma.job.update({
        where: { id: created.id },
        data: { status: JobStatus.ALERTED, alertedAt: new Date() },
      });
      stats.alerted++;
    } catch (err) {
      stats.alertFailed++;
      logger.error(
        { err, jobId: created.id, title: created.title },
        'process-jobs: alert failed',
      );
    }
  }
}

function buildClassifyInput(
  job: NormalizedJob,
  companyName: string,
): ClassifyInput {
  return {
    title: job.title,
    companyName,
    location: job.location,
    description: job.description,
    postedAt: job.postedAt,
  };
}

function decideDismissReason(
  c: ClaudeClassification,
  profile: Profile,
): 'low-fit' | 'location-mismatch' | 'low-salary' | null {
  if (c.fit_score < profile.minFitScore) return 'low-fit';
  if (!c.location_match) return 'location-mismatch';
  if (
    profile.minSalaryUsd > 0 &&
    c.salary_min_usd !== null &&
    c.salary_min_usd > 0 &&
    c.salary_min_usd < profile.minSalaryUsd
  ) {
    return 'low-salary';
  }
  return null;
}

function buildJobData(
  job: NormalizedJob,
  c: ClaudeClassification,
  status: JobStatus,
): Prisma.JobCreateInput {
  return {
    company: { connect: { id: job.companyId } },
    externalId: job.externalId,
    title: job.title,
    url: job.url,
    location: job.location,
    description: job.description,
    postedAt: job.postedAt,
    fitScore: c.fit_score,
    salaryMin: c.salary_min_usd,
    salaryMax: c.salary_max_usd,
    techMatch: c.tech_match,
    redFlags: c.red_flags,
    summary: c.summary,
    status,
  };
}
