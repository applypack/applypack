import { JobStatus, Prisma, type Job, type Profile } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { passesBaseFilter } from '../filter';
import { withApplyLinkFlags } from '../apply-link';
import { classifyJob, type ClassifyOutcome } from '../classifier';
import { isBlankProfile, NO_PROFILE_STACK_FLAG } from '../profile-guards';
import { sendTelegramAlert } from '../notifier';
import { applyPriorityFloor, parsePriorityRules } from '../priority-rules';
import type { ClassifierMode } from '../settings';
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
  /** 1 when the tick skipped classify+alerts because the profile is blank. */
  skippedBlankProfile: number;
}

export interface ProcessOptions {
  classifierMode: ClassifierMode;
  /**
   * false = store what passes the filter unscored (fitScore null, no AI, no
   * alerts): the dashboard's "Fetch now" while the pipeline is paused. The
   * cron dedupes on (companyId, externalId), so it never revisits those rows;
   * scoring is left to Re-classify. Default true.
   */
  classify?: boolean;
  isCancelled?: () => Promise<boolean>;
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
  stats: ProcessStats,
  opts: ProcessOptions,
): Promise<void> {
  const { classifierMode, classify = true, isCancelled } = opts;

  // Issue #50: a profile with no required stack and no role types has nothing
  // to gate on — the filter admits everything and the classifier scores on
  // vibes. Fetching already happened (source health stays alive); stop here.
  if (classify && isBlankProfile(profile)) {
    stats.skippedBlankProfile = 1;
    logger.warn(
      { profile: profile.name },
      'process-jobs: active profile has no required stack and no role types; skipping classification and alerts',
    );
    return;
  }

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
  const batch: Batch = {
    stats,
    recentFingerprints: candidates.length > 0 ? await loadRecentFingerprints() : [],
  };

  if (!classify) {
    for (const item of candidates) {
      await persistJob(item, null, JobStatus.NEW, [], batch);
    }
    return;
  }

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
  for (const item of pending) {
    const { job, companyName, outcome } = item;
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

    const dismissReason = decideDismissReason(finalClassification, profile);
    if (dismissReason) {
      const stored = await persistJob(item, finalClassification, JobStatus.DISMISSED, appliedLabels, batch);
      if (stored) {
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
      }
      continue;
    }

    const stored = await persistJob(item, finalClassification, JobStatus.NEW, appliedLabels, batch);
    if (!stored) continue;
    const { created, crossListing } = stored;

    // A score produced without a required stack never alerts, whatever the
    // threshold or priority boosts say (issue #50). The row stays NEW.
    if (finalClassification.red_flags.includes(NO_PROFILE_STACK_FLAG)) {
      continue;
    }

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

/** State shared by every persist of one call: the batch stats and the
 *  fingerprint window, which grows as rows are stored. */
interface Batch {
  stats: ProcessStats;
  recentFingerprints: FingerprintedJob[];
}

type CrossListing = ReturnType<typeof findCrossListing<FingerprintedJob>>;

/**
 * Fingerprint, annotate a cross-listing (ADR 0018) and store the row. Returns
 * null when the unique key clashed: the hourly tick and a dashboard "Fetch
 * now" can overlap, and the loser of that race holds a duplicate, not an error.
 */
async function persistJob(
  { job, companyName }: FetchResult,
  c: ClaudeClassification | null,
  status: JobStatus,
  priorityRulesApplied: string[],
  { stats, recentFingerprints }: Batch,
): Promise<{ created: Job; crossListing: CrossListing } | null> {
  const fingerprint = simhash64(job.description);
  const crossListing = findCrossListing(fingerprint, job.companyId, recentFingerprints);
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

  let created: Job;
  try {
    created = await prisma.job.create({
      data: buildJobData(job, c, status, priorityRulesApplied, {
        descriptionSimhash: fingerprint,
        crossListedOfJobId: crossListing?.job.id ?? null,
      }),
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      stats.duplicate++;
      logger.warn(
        { title: job.title, companyName },
        'process-jobs: stored by another run meanwhile; counted as duplicate',
      );
      return null;
    }
    throw err;
  }
  recentFingerprints.push({
    id: created.id,
    companyId: job.companyId,
    descriptionSimhash: fingerprint,
  });
  stats.persisted++;
  return { created, crossListing };
}

interface DedupData {
  descriptionSimhash: bigint | null;
  crossListedOfJobId: number | null;
}

/** `c === null` stores the posting unscored — every classifier field stays empty. */
function buildJobData(
  job: NormalizedJob,
  c: ClaudeClassification | null,
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
    fitScore: c?.fit_score ?? null,
    salaryMin: c?.salary_min_usd ?? null,
    salaryMax: c?.salary_max_usd ?? null,
    techMatch: c?.tech_match ?? [],
    // `pasted: false` is an invariant, not an assumption: a MANUAL company's
    // fetchOne returns [], so a pasted row never reaches this loop. Pasted
    // jobs get their flags from classify-existing.ts instead.
    redFlags: withApplyLinkFlags(c?.red_flags ?? [], { url: job.url, pasted: false }),
    summary: c?.summary ?? null,
    status,
    priorityRulesApplied,
  };
}
