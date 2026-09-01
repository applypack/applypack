import { JobStatus, type Prisma, type Profile } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { passesBaseFilter } from '../filter';
import { withApplyLinkFlags } from '../apply-link';
import { classifyJob, type ClassifyOutcome } from '../classifier';
import { sendTelegramAlert } from '../notifier';
import { applyPriorityFloor, parsePriorityRules } from '../priority-rules';
import {
  findCrossListing,
  fromDbBigInt,
  simhash64,
  toDbBigInt,
  type FingerprintedJob,
} from '../fingerprint';

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
  crossListed: number;
  /** 1 when the run stopped early because fetching was paused mid-run. */
  abortedMidRun: number;
  /** Classifications scheduled but discarded by the mid-run abort. */
  skippedByPause: number;
}

/** How far back the cross-listing scan looks. */
const DEDUP_WINDOW_DAYS = 90;

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
  isCancelled?: () => Promise<boolean>,
): Promise<void> {
  const priorityRules = parsePriorityRules(profile.priorityRules);

  // Once true, queued classify thunks below become no-ops, so an abort
  // stops the AI spend, not just the persist/alert loop.
  let cancelled = false;

  // `seen` catches the same posting twice in one fetch: the sequential loop
  // used to see it in the DB, now both copies would be classified together.
  const candidates: FetchResult[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (isCancelled && (await isCancelled())) {
      cancelled = true;
      break;
    }
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
  if (cancelled) {
    stats.abortedMidRun = 1;
    logger.warn('process-jobs: aborted before classify (fetching paused mid-run)');
    return;
  }

  // Fingerprints of everything ingested in the dedup window, read once for
  // the whole batch. Cross-listing is an annotation, so this never changes
  // which jobs get classified (ADR 0018).
  const recentFingerprints =
    candidates.length > 0 ? await loadRecentFingerprints() : [];

  // Classify up to AI_CONCURRENCY jobs at once; results are consumed in the
  // original order, so persisting and alerting stay sequential and ordered.
  const limit = createLimiter(config.AI_CONCURRENCY);
  const pending = candidates.map((item) => ({
    ...item,
    outcome: limit(async (): Promise<ClassifyOutcome> => {
      if (cancelled) return { result: null, preFiltered: false };
      return classifyJob(
        buildClassifyInput(item.job, item.companyName),
        profile,
        classifierMode,
      );
    }),
  }));
  if (pending.length > 0) {
    logger.info(
      { jobs: pending.length, concurrency: config.AI_CONCURRENCY },
      'process-jobs: classifying',
    );
  }

  let consumed = 0;
  for (const { job, companyName, outcome } of pending) {
    if (isCancelled && (await isCancelled())) {
      cancelled = true;
      stats.abortedMidRun = 1;
      stats.skippedByPause = pending.length - consumed;
      logger.warn(
        { consumed, skipped: pending.length - consumed },
        'process-jobs: aborted mid-run (fetching paused); discarding unconsumed classifications',
      );
      // In-flight classifications (≤ AI_CONCURRENCY) finish in the
      // background and are discarded; swallow their rejections.
      void Promise.allSettled(pending.map((p) => p.outcome));
      break;
    }
    consumed++;
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

    const fingerprint = simhash64(job.description);
    const crossListing = findCrossListing(
      fingerprint,
      job.companyId,
      recentFingerprints,
    );
    if (crossListing) {
      stats.crossListed++;
      logger.info(
        {
          title: job.title,
          companyName,
          originalJobId: crossListing.job.id,
          distance: crossListing.distance,
        },
        'process-jobs: cross-listed posting',
      );
    }
    const dedup = {
      descriptionSimhash: fingerprint,
      crossListedOfJobId: crossListing?.job.id ?? null,
    };

    const dismissReason = decideDismissReason(finalClassification, profile);
    if (dismissReason) {
      const dismissed = await prisma.job.create({
        data: buildJobData(
          job,
          finalClassification,
          JobStatus.DISMISSED,
          appliedLabels,
          dedup,
        ),
      });
      recentFingerprints.push({
        id: dismissed.id,
        companyId: job.companyId,
        descriptionSimhash: fingerprint,
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
      data: buildJobData(
        job,
        finalClassification,
        JobStatus.NEW,
        appliedLabels,
        dedup,
      ),
    });
    recentFingerprints.push({
      id: created.id,
      companyId: job.companyId,
      descriptionSimhash: fingerprint,
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
          crossListedAt: crossListing
            ? await companyNameOfJob(crossListing.job.id)
            : null,
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

/** Fingerprints from the dedup window, oldest first. */
async function loadRecentFingerprints(): Promise<FingerprintedJob[]> {
  const since = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.job.findMany({
    where: { fetchedAt: { gte: since }, descriptionSimhash: { not: null } },
    select: { id: true, companyId: true, descriptionSimhash: true },
    orderBy: { fetchedAt: 'asc' },
  });
  return rows.map((r) => ({ ...r, descriptionSimhash: fromDbBigInt(r.descriptionSimhash) }));
}

/** Company of an already-stored job — only read when a cross-listing hits, so
 *  the window scan itself stays a two-column read. */
async function companyNameOfJob(jobId: number): Promise<string | null> {
  const row = await prisma.job.findUnique({
    where: { id: jobId },
    select: { company: { select: { name: true } } },
  });
  return row?.company.name ?? null;
}

interface DedupData {
  descriptionSimhash: bigint | null;
  crossListedOfJobId: number | null;
}

function buildJobData(
  job: NormalizedJob,
  c: ClaudeClassification,
  status: JobStatus,
  priorityRulesApplied: string[],
  dedup: DedupData,
): Prisma.JobCreateInput {
  return {
    company: { connect: { id: job.companyId } },
    descriptionSimhash: toDbBigInt(dedup.descriptionSimhash),
    ...(dedup.crossListedOfJobId !== null && {
      crossListedOf: { connect: { id: dedup.crossListedOfJobId } },
    }),
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
    // `pasted: false` is an invariant, not an assumption: a MANUAL company's
    // fetchOne returns [], so a pasted row never reaches this loop. Pasted
    // jobs get their flags from classify-existing.ts instead.
    redFlags: withApplyLinkFlags(c.red_flags, { url: job.url, pasted: false }),
    summary: c.summary,
    status,
    priorityRulesApplied,
  };
}

