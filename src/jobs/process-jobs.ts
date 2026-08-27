import { JobStatus, type Prisma, type Profile } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { passesBaseFilter } from '../filter';
import { classifyJob } from '../classifier';
import { sendTelegramAlert } from '../notifier';
import { applyPriorityFloor, parsePriorityRules } from '../priority-rules';

export { applyPriorityFloor };
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
  priorityBoosted: number;
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
  const priorityRules = parsePriorityRules(profile.priorityRules);

  // `seen` catches the same posting twice in one fetch: the sequential loop
  // used to see it in the DB, now both copies would be classified together.
  const candidates: FetchResult[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!passesBaseFilter(item.job, profile)) {
      stats.filterRejected++;
      continue;
    }
    const key = `${item.job.companyId}:${item.job.externalId}`;
    if (seen.has(key) || (await isPersisted(item.job))) {
      stats.duplicate++;
      continue;
    }
    seen.add(key);
    candidates.push(item);
  }

  // Classify up to AI_CONCURRENCY jobs at once; results are consumed in the
  // original order, so persisting and alerting stay sequential and ordered.
  const limit = createLimiter(config.AI_CONCURRENCY);
  const pending = candidates.map((item) => ({
    ...item,
    outcome: limit(() =>
      classifyJob(buildClassifyInput(item.job, item.companyName), profile, classifierMode),
    ),
  }));
  if (pending.length > 0) {
    logger.info(
      { jobs: pending.length, concurrency: config.AI_CONCURRENCY },
      'process-jobs: classifying',
    );
  }

  for (const { job, companyName, outcome } of pending) {
    const { result: classification, preFiltered } = await outcome;
    if (preFiltered) {
      stats.preFiltered++;
      continue;
    }
    if (!classification) {
      stats.classifyFailed++;
      continue;
    }
    stats.classified++;

    const priority = applyPriorityFloor(classification, priorityRules, job);
    if (priority.applied.length > 0) {
      stats.priorityBoosted++;
      logger.info(
        {
          title: job.title,
          companyName,
          fitBefore: classification.fit_score,
          fitAfter: priority.classification.fit_score,
          rules: priority.applied.map((r) => r.label),
        },
        'process-jobs: priority rule applied',
      );
    }
    const finalClassification = priority.classification;
    const appliedLabels = priority.applied.map((r) => r.label);

    const dismissReason = decideDismissReason(finalClassification, profile);
    if (dismissReason) {
      await prisma.job.create({
        data: buildJobData(
          job,
          finalClassification,
          JobStatus.DISMISSED,
          appliedLabels,
        ),
      });
      stats.persisted++;
      stats.dismissed++;
      logger.debug(
        {
          title: job.title,
          companyName,
          fitScore: finalClassification.fit_score,
          reason: dismissReason,
        },
        'process-jobs: dismissed',
      );
      continue;
    }

    const created = await prisma.job.create({
      data: buildJobData(job, finalClassification, JobStatus.NEW, appliedLabels),
    });
    stats.persisted++;

    try {
      await sendTelegramAlert(
        {
          title: created.title,
          companyName,
          location: created.location,
          url: created.url,
          fitScore: created.fitScore ?? finalClassification.fit_score,
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

async function isPersisted(job: NormalizedJob): Promise<boolean> {
  const existing = await prisma.job.findUnique({
    where: {
      companyId_externalId: {
        companyId: job.companyId,
        externalId: job.externalId,
      },
    },
    select: { id: true },
  });
  return existing !== null;
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
  priorityRulesApplied: string[],
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
    priorityRulesApplied,
  };
}

