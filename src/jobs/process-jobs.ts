import { JobStatus, Prisma, type Job, type Profile } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { passesAnyBaseFilter } from '../filter';
import { withApplyLinkFlags } from '../apply-link';
import { parseLocation } from '../location';
import { classifyJob, type ClassifyOutcome } from '../classifier';
import { buildVerdicts, mergeVerdicts, type ProfileVerdict } from './verdict-merge';
import { toScoreData } from './score-store';
import { mergeAiLocation, type StoredPlace } from './location-merge';
import { isBlankProfile, NO_PROFILE_STACK_FLAG } from '../profile-guards';
import { sendTelegramAlert } from '../notifier';
import { attributionLine } from '../web/pages/attribution';
import type { ClassifierMode } from '../settings';
import {
  findCrossListing,
  fromDbBigInt,
  simhash64,
  toDbBigInt,
  type FingerprintedJob,
} from '../fingerprint';

import type {
  ClaudeClassification,
  ClassifyInput,
  NormalizedJob,
} from '../types';

export interface FetchResult {
  job: NormalizedJob;
  companyName: string;
  /** Which source the row came from — the alert's attribution line reads it (ADR 0034). HN rows carry none. */
  source?: { atsType: string; atsToken: string };
}

/** A fetched row plus its parsed location — read once, used by the filter and the insert. */
interface Candidate extends FetchResult {
  place: StoredPlace;
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
  /** 1 when the tick skipped classify+alerts because no usable search is active. */
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
  activeProfiles: Profile[],
  stats: ProcessStats,
  opts: ProcessOptions,
): Promise<void> {
  const { classifierMode, classify = true, isCancelled } = opts;

  // Issue #50: a search with no required stack and no role types has nothing
  // to gate on — the filter admits everything and the classifier scores on
  // vibes. With several searches running one blank row must not silence the
  // others, so it is dropped from the roster rather than aborting the tick.
  const profiles = activeProfiles.filter((p) => !isBlankProfile(p));
  const blank = activeProfiles.filter((p) => isBlankProfile(p));
  if (blank.length > 0) {
    logger.warn(
      { blank: blank.map((p) => p.name) },
      'process-jobs: search has no required stack and no role types; excluded from this tick',
    );
  }
  // Fetching already happened (source health stays alive); stop here.
  if (classify && profiles.length === 0) {
    stats.skippedBlankProfile = 1;
    logger.warn('process-jobs: no usable active search; skipping classification and alerts');
    return;
  }

  // Once true, queued classify thunks below become no-ops, so an abort
  // stops the AI spend, not just the persist/alert loop.
  let cancelled = false;

  // `seen` catches the same posting twice in one fetch: the sequential loop
  // used to see it in the DB, now both copies would be classified together.
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (isCancelled && (await isCancelled())) {
      cancelled = true;
      break;
    }
    // The structured reading of the location string (ADR 0031): the source's
    // hints first, the parser for the rest. The filter compares its columns
    // with each search's (ADR 0032); the insert stores them as they are here.
    const place = parseLocation(item.job.location, item.job.locationHints);
    // A posting is admitted when ANY active search admits it (ADR 0028).
    // Storing unscored keeps the UNFILTERED roster on purpose: the wizard's
    // step 2 runs "Fetch now" before step 3 creates a profile, so at that
    // moment every search is blank — and a blank search's gate admits
    // everything, which is what makes the fresh-install run show results.
    if (!passesAnyBaseFilter({ ...item.job, ...place }, classify ? profiles : activeProfiles)) {
      stats.filterRejected++;
      continue;
    }
    const key = `${item.job.companyId}:${item.job.externalId}`;
    if (seen.has(key) || (await isPersisted(item.job))) {
      stats.duplicate++;
      continue;
    }
    seen.add(key);
    candidates.push({ ...item, place });
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
      if (cancelled) return { results: new Map(), location: null, preFiltered: false };
      return classifyJob(
        buildClassifyInput(item.job, item.companyName, item.place),
        profiles,
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
    const { results, location, preFiltered } = await outcome;
    // The model read the whole description; where it knows more than the
    // location line said, the row is stored with that (ADR 0032).
    const placed: Candidate = { ...item, place: mergeAiLocation(item.place, location) };
    if (preFiltered) {
      stats.preFiltered++;
      continue;
    }
    if (results.size === 0) {
      stats.classifyFailed++;
      continue;
    }
    stats.classified++;

    // Every search judges the posting with its own rules and its own
    // thresholds — the reply is shared, the verdict is not.
    const { verdicts, boosted } = buildVerdicts(results, profiles, job);
    stats.priorityBoosted += boosted;
    const merged = mergeVerdicts(verdicts);
    if (!merged) {
      stats.classifyFailed++;
      continue;
    }
    const { winner, kept, scoreLine } = merged;
    const finalClassification = winner.classification;

    if (!kept) {
      const stored = await persistJob(
        placed,
        finalClassification,
        JobStatus.DISMISSED,
        winner.priorityRulesApplied,
        batch,
        verdicts,
      );
      if (stored) {
        stats.dismissed++;
        logger.debug(
          {
            title: job.title,
            companyName,
            fitScore: finalClassification.fit_score,
            reason: winner.dismissReason,
            searches: scoreLine,
          },
          'process-jobs: dismissed by every search',
        );
      }
      continue;
    }

    const stored = await persistJob(
      placed,
      finalClassification,
      JobStatus.NEW,
      winner.priorityRulesApplied,
      batch,
      verdicts,
    );
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
          attribution: item.source ? attributionLine(item.source.atsType, item.source.atsToken) : null,
          location: created.location,
          countries: created.countries,
          workplace: created.workplace,
          url: created.url,
          fitScore: created.fitScore ?? finalClassification.fit_score,
          salaryMin: created.salaryMin,
          salaryCurrency: created.salaryCurrency,
          salaryPeriod: created.salaryPeriod,
          salaryMax: created.salaryMax,
          techMatch: created.techMatch,
          redFlags: created.redFlags,
          summary: created.summary ?? '',
          crossListedAt: crossListing
            ? await companyNameOfJob(crossListing.job.id)
            : null,
          // One alert per posting. With a single search running, naming it
          // adds nothing and the message stays exactly what it is today; with
          // several, the header says which hunt fired and the line says what
          // the others made of it (ADR 0028).
          matchedProfile: verdicts.length > 1 ? winner.profileName : null,
          profileScores: verdicts.length > 1 ? scoreLine : null,
        },
        // Routed to the winning search's chat; null still broadcasts.
        winner.telegramTargetId,
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
  place: StoredPlace,
): ClassifyInput {
  return {
    title: job.title,
    companyName,
    location: job.location,
    place,
    description: job.description,
    postedAt: job.postedAt,
  };
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
  { job, companyName, place }: Candidate,
  c: ClaudeClassification | null,
  status: JobStatus,
  priorityRulesApplied: string[],
  { stats, recentFingerprints }: Batch,
  verdicts: ProfileVerdict[] = [],
): Promise<{ created: Job; crossListing: CrossListing } | null> {
  const fingerprint = simhash64(job.description);
  const crossListing = findCrossListing(fingerprint, job.companyId, recentFingerprints);

  let created: Job;
  try {
    created = await prisma.job.create({
      data: {
        ...buildJobData(job, place, c, status, priorityRulesApplied, {
          descriptionSimhash: fingerprint,
          crossListedOfJobId: crossListing?.job.id ?? null,
        }),
        // Every search's verdict, written with the row it belongs to — a
        // second statement could leave a scored Job with no JobScore.
        // `pasted: false` is the same invariant buildJobData relies on: a
        // MANUAL company's fetchOne returns [], so no pasted row reaches here.
        scores: {
          create: verdicts.map((v) => toScoreData(v, { url: job.url, pasted: false })),
        },
      },
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
  return { created, crossListing };
}

interface DedupData {
  descriptionSimhash: bigint | null;
  crossListedOfJobId: number | null;
}

/** `c === null` stores the posting unscored — every classifier field stays empty. */
function buildJobData(
  job: NormalizedJob,
  place: StoredPlace,
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
    workplace: place.workplace,
    countries: place.countries,
    regions: place.regions,
    locationSource: place.source,
    description: job.description,
    postedAt: job.postedAt,
    fitScore: c?.fit_score ?? null,
    salaryMin: c?.salary_min ?? null,
    salaryMax: c?.salary_max ?? null,
    salaryCurrency: c?.salary_currency ?? null,
    salaryPeriod: c?.salary_period ?? null,
    ...(job.sourcePayload !== undefined ? { sourcePayload: job.sourcePayload as Prisma.InputJsonValue } : {}),
    ...(job.sourceUpdatedAt ? { sourceUpdatedAt: job.sourceUpdatedAt, sourceCheckedAt: new Date() } : {}),
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
