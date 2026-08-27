import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { classifyJob } from '../classifier';
import { passesBaseFilter } from '../filter';
import { getActiveProfile } from '../profiles';
import { getSettings } from '../settings';
import { parsePriorityRules } from '../priority-rules';
import { applyPriorityFloor } from './process-jobs';
import type { CronStats } from './cron-run';

const RECLASSIFY_BATCH_SIZE = 50;

/**
 * Re-classifies all jobs (except APPLIED) against the currently active
 * profile. Updates fitScore / techMatch / redFlags / summary / salary, and
 * may move jobs between NEW and DISMISSED based on the new score.
 */
export async function runReclassifyAll(): Promise<{ stats: CronStats }> {
  const started = Date.now();
  const profile = await getActiveProfile();
  if (!profile) {
    logger.warn('reclassify-all: no active profile');
    return { stats: { aborted: 1, reason: 'no-active-profile' } };
  }

  const { classifierMode } = await getSettings();
  const priorityRules = parsePriorityRules(profile.priorityRules);
  logger.info(
    {
      profile: profile.name,
      classifierMode,
      priorityRules: priorityRules.length,
      concurrency: config.AI_CONCURRENCY,
    },
    'reclassify-all: start',
  );

  let scanned = 0;
  let reclassified = 0;
  let preFiltered = 0;
  let promoted = 0; // moved DISMISSED → NEW
  let demoted = 0; // moved NEW/SAVED/ALERTED → DISMISSED
  let unchanged = 0;
  let failed = 0;
  let filterRejected = 0;
  let priorityBoosted = 0;

  const limit = createLimiter(config.AI_CONCURRENCY);
  let lastId = 0;
  while (true) {
    const batch = await prisma.job.findMany({
      where: {
        status: { not: JobStatus.APPLIED },
        id: { gt: lastId },
      },
      include: { company: { select: { name: true } } },
      orderBy: { id: 'asc' },
      take: RECLASSIFY_BATCH_SIZE,
    });
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;

    // Jobs that fail the current profile's base filter skip Claude entirely;
    // the rest are classified AI_CONCURRENCY at a time and persisted in
    // id order as their results come in.
    const pending = batch.map((j) => ({
      job: j,
      outcome: passesBaseFilter(j, profile)
        ? limit(() =>
            classifyJob(
              {
                title: j.title,
                companyName: j.company.name,
                location: j.location,
                description: j.description,
                postedAt: j.postedAt,
              },
              profile,
              classifierMode,
            ),
          )
        : null,
    }));

    for (const { job: j, outcome } of pending) {
      scanned++;

      if (outcome === null) {
        if (j.status !== JobStatus.DISMISSED) {
          await prisma.job.update({
            where: { id: j.id },
            data: { status: JobStatus.DISMISSED },
          });
          demoted++;
        }
        filterRejected++;
        continue;
      }

      const { result: c0, preFiltered: wasPreFiltered } = await outcome;
      if (wasPreFiltered) {
        preFiltered++;
        // Reclassify treats pre-filtered jobs the same as base-filter rejects:
        // demote to DISMISSED so they leave the inbox.
        if (j.status !== JobStatus.DISMISSED) {
          await prisma.job.update({
            where: { id: j.id },
            data: { status: JobStatus.DISMISSED },
          });
          demoted++;
        }
        continue;
      }
      if (!c0) {
        failed++;
        continue;
      }
      reclassified++;

      const priority = applyPriorityFloor(c0, priorityRules, j);
      if (priority.applied.length > 0) priorityBoosted++;
      const c = priority.classification;
      const appliedLabels = priority.applied.map((r) => r.label);

      const previousStatus = j.status;
      const dismissReason = decide(c, profile);
      const targetStatus = dismissReason
        ? JobStatus.DISMISSED
        : previousStatus === JobStatus.DISMISSED
          ? JobStatus.NEW
          : previousStatus;

      await prisma.job.update({
        where: { id: j.id },
        data: {
          fitScore: c.fit_score,
          salaryMin: c.salary_min_usd,
          salaryMax: c.salary_max_usd,
          techMatch: c.tech_match,
          redFlags: c.red_flags,
          summary: c.summary,
          status: targetStatus,
          priorityRulesApplied: appliedLabels,
        },
      });

      if (
        targetStatus === JobStatus.NEW &&
        previousStatus === JobStatus.DISMISSED
      ) {
        promoted++;
      } else if (
        targetStatus === JobStatus.DISMISSED &&
        previousStatus !== JobStatus.DISMISSED
      ) {
        demoted++;
      } else {
        unchanged++;
      }
    }
  }

  const durationMs = Date.now() - started;
  const stats: CronStats = {
    profile: profile.name,
    classifierMode,
    concurrency: config.AI_CONCURRENCY,
    scanned,
    reclassified,
    preFiltered,
    promoted,
    demoted,
    unchanged,
    filterRejected,
    priorityBoosted,
    failed,
    durationMs,
  };
  logger.info(stats, 'reclassify-all: done');
  return { stats };
}

function decide(
  c: { fit_score: number; location_match: boolean; salary_min_usd: number | null },
  profile: { minFitScore: number; minSalaryUsd: number },
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
