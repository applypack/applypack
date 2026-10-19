import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { classifyJob } from '../classifier';
import { anyBaseFilterReason } from '../filter';
import { DISMISS_KEY, FILTER_KEY, isFirstScoring, scorePassCounts } from '../funnel';
import { addCountsToDay } from './funnel-store';
import { getActiveProfile, listActiveProfiles } from '../profiles';
import { getSettings } from '../settings';
import { isBlankProfile } from '../profile-guards';
import { buildVerdicts, mergeVerdicts } from './verdict-merge';
import { saveJobScores } from './score-store';
import { storedPlace } from './classify-existing';
import { mergeAiLocation } from './location-merge';
import { handPickedSource, statusAfterRescore } from './rescore-status';
import { pickBatch, rankByProfileFit, SCORE_BATCH, type LinkedJob, type ScorableJob } from './score-pick';
import { companyForPrompt, withoutMuted } from '../employer';
import { mutedKeys } from './employer-store';

export { SCORE_BATCH };

const RECLASSIFY_BATCH_SIZE = 50;

export interface ReclassifyOptions {
  /** Restrict the pass to these ids; default: every job except APPLIED. */
  ids?: number[];
  onProgress?: (done: number, total: number) => void;
}

/**
 * Re-classifies all jobs (except APPLIED) against every active search
 * (ADR 0028). Rewrites that job's JobScore rows and the best-of on the Job
 * row, and may move jobs between NEW and DISMISSED — dismissed only when
 * every search rejects them, and never a Saved row or a posting the user
 * pasted or saved as a file (rescore-status.ts).
 */
export async function runReclassifyAll() {
  const started = new Date();
  const { stats, firstScoring } = await reclassify({});
  // Postings a paused fetch stored unscored, scored here for the first time: the Overview's chart and /runs's funnel count them (#552).
  await addCountsToDay(started, scorePassCounts(firstScoring)).catch((err) => logger.warn({ err }, 'reclassify-all: funnel day not updated'));
  return { stats };
}

/** How many jobs `runReclassifyAll` reads — the number "Save & re-classify" asks about (#562). */
export async function countReclassifyAll(): Promise<number> {
  return prisma.job.count({ where: await passScope() });
}

/** Every job a pass reads: none applied to, and none at a muted company — a mute promises no AI on them (ADR 0056). */
async function passScope() {
  return { status: { not: JobStatus.APPLIED }, ...withoutMuted(await mutedKeys()) };
}

/**
 * The wizard's step 4: jobs a paused "Fetch now" stored unscored get their
 * score against the profile that now exists. Rows failing the base filter
 * are dismissed in one update — no AI spent on them (a saved posting is not
 * filtered here either, ADR 0062); of the rest, the
 * `limit` best matches by rankByProfileFit are classified (the wizard reads
 * the most promising ten, not the ten most recent), a cross-listed copy
 * after every other posting (pickBatch), and `remaining` says how many a
 * second press would take.
 */
export async function runScoreUnscored(
  opts: Pick<ReclassifyOptions, 'onProgress'> & { limit?: number } = {},
) {
  const profiles = (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
  if (profiles.length === 0) return { stats: { aborted: 1, reason: 'no-active-profile' } };
  // The wizard reads the most promising ten, and "promising" needs one
  // yardstick — the primary's, falling back to the first running search.
  const primary = (await getActiveProfile()) ?? profiles[0]!;
  const ranker = isBlankProfile(primary) ? profiles[0]! : primary;

  const unscored = await prisma.job.findMany({
    // A muted company's rows are never scored: a mute promises no AI on them (ADR 0056).
    where: { fitScore: null, status: JobStatus.NEW, ...withoutMuted(await mutedKeys()) },
    select: {
      id: true,
      title: true,
      location: true,
      workplace: true,
      countries: true,
      regions: true,
      description: true,
      fetchedAt: true,
      crossListedOfJobId: true,
      company: { select: { atsType: true, sourceConfig: true } },
    },
  });
  const rejectedIds: number[] = [];
  const rejectedBy = { rejectedTitle: 0, rejectedExcluded: 0, rejectedWorkplace: 0, rejectedPlace: 0 };
  const passing: (ScorableJob & LinkedJob)[] = [];
  for (const j of unscored) {
    const rejected = handPickedSource(j.company) ? null : anyBaseFilterReason(j, profiles);
    if (rejected === null) {
      passing.push(j);
    } else {
      rejectedIds.push(j.id);
      rejectedBy[FILTER_KEY[rejected]]++;
    }
  }
  if (rejectedIds.length > 0) {
    await prisma.job.updateMany({
      where: { id: { in: rejectedIds } },
      data: { status: JobStatus.DISMISSED },
    });
  }
  const started = new Date();
  const ranked = rankByProfileFit(passing, ranker);
  // The scored rows a waiting one is a copy of, or that copy one (ADR 0018).
  const scoredBeside = await prisma.job.findMany({
    where: {
      fitScore: { not: null },
      OR: [
        { id: { in: passing.flatMap((j) => (j.crossListedOfJobId === null ? [] : [j.crossListedOfJobId])) } },
        { crossListedOfJobId: { in: passing.map((j) => j.id) } },
      ],
    },
    select: { id: true, crossListedOfJobId: true },
  });
  const ids = pickBatch(ranked, [...passing, ...scoredBeside], new Set(scoredBeside.map((j) => j.id)), opts.limit ?? SCORE_BATCH);
  const { stats } = await reclassify({ ids, onProgress: opts.onProgress });
  const out = {
    ...stats,
    unscored: unscored.length,
    filterDismissed: rejectedIds.length,
    ...rejectedBy,
    remaining: ranked.length - ids.length,
  };
  // These postings were never scored before: the Overview's chart and /runs's funnel count what this found.
  await addCountsToDay(started, scorePassCounts(out));
  return { stats: out };
}

async function reclassify(opts: ReclassifyOptions) {
  const started = Date.now();
  // Issue #50: re-scoring against a blank search would overwrite real scores
  // with vibes-based ones and demote most of the inbox, so blank rows are
  // dropped from the roster rather than aborting the pass.
  const profiles = (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
  if (profiles.length === 0) {
    logger.warn('reclassify-all: no usable active search');
    return { stats: { aborted: 1, reason: 'no-active-profile' }, firstScoring: {} };
  }

  const { classifierMode } = await getSettings();
  const scope = {
    ...(await passScope()),
    ...(opts.ids && { id: { in: opts.ids } }),
  };
  const total = await prisma.job.count({ where: scope });
  logger.info(
    {
      searches: profiles.map((p) => p.name),
      classifierMode,
      concurrency: config.AI_CONCURRENCY,
    },
    'reclassify-all: start',
  );

  let scanned = 0;
  let reclassified = 0;
  let preFiltered = 0;
  let promoted = 0; // moved DISMISSED → NEW
  let demoted = 0; // moved NEW/ALERTED → DISMISSED
  let keptSaved = 0; // a hand-picked posting no search wants: NEW/ALERTED → SAVED
  let unchanged = 0;
  let matched = 0; // kept by a search, whatever its status was
  let failed = 0;
  let filterRejected = 0;
  let priorityBoosted = 0;
  // Why a scored job was set aside, by the winning search's reason — the
  // wizard's "look like a match" line says why the rest did not (N2).
  const dismissedBy = { dismissedLowFit: 0, dismissedLocation: 0, dismissedSalary: 0 };
  // Why the last failed call failed — "no API key", "HTTP 401 …" — so the
  // flash and /runs can say it instead of leaving it to the container logs (#97).
  let lastError: string | null = null;
  // The same counts for the rows scored here for the first time, under the names scorePassCounts reads.
  const firstScoring: Record<string, number> = {};
  const countFirst = (j: { fitScore: number | null; status: JobStatus }, ...keys: string[]): void => {
    if (!isFirstScoring(j)) return;
    for (const key of keys) firstScoring[key] = (firstScoring[key] ?? 0) + 1;
  };

  const limit = createLimiter(config.AI_CONCURRENCY);
  let lastId = 0;
  while (true) {
    const batch = await prisma.job.findMany({
      where: {
        ...scope,
        id: { ...scope.id, gt: lastId },
      },
      include: { company: { select: { name: true, atsType: true, sourceConfig: true } } },
      orderBy: { id: 'asc' },
      take: RECLASSIFY_BATCH_SIZE,
    });
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;

    // Jobs no active search admits skip Claude entirely; the rest are
    // classified AI_CONCURRENCY at a time and persisted in id order as their
    // results come in. A posting the user chose is scored whatever the filter
    // says, as it was when it came in (ADR 0062).
    const pending = batch.map((j) => {
      const chosen = handPickedSource(j.company);
      const rejected = chosen ? null : anyBaseFilterReason(j, profiles);
      return {
        job: j,
        chosen,
        rejected,
        outcome: rejected === null
          ? limit(() =>
              classifyJob(
                {
                  title: j.title,
                  companyName: companyForPrompt(j.employer, j.company),
                  location: j.location,
                  place: { workplace: j.workplace, countries: j.countries, regions: j.regions },
                  description: j.description,
                  postedAt: j.postedAt,
                },
                profiles,
                classifierMode,
                {
                  jobId: j.id,
                  onError: (reason) => {
                    lastError = reason;
                  },
                },
              ),
            )
          : null,
      };
    });

    // Rows the scoring never reached (the filter, the prefilter) are moved
    // once per batch (DATA-4): a "Re-classify all" over thousands of rows was
    // thousands of single-row updates, next to an updateMany the same file
    // already uses above.
    const demoteIds: number[] = [];
    const saveIds: number[] = [];
    const turnDown = (j: { id: number; status: JobStatus }, chosen: boolean): void => {
      const target = statusAfterRescore(j.status, false, chosen);
      if (target === j.status) return;
      if (target === JobStatus.SAVED) {
        saveIds.push(j.id);
        keptSaved++;
      } else {
        demoteIds.push(j.id);
        demoted++;
      }
    };
    for (const { job: j, chosen, rejected, outcome } of pending) {
      scanned++;
      opts.onProgress?.(scanned, total);

      if (outcome === null) {
        turnDown(j, chosen);
        filterRejected++;
        if (rejected !== null) countFirst(j, 'filterDismissed', FILTER_KEY[rejected]);
        continue;
      }

      const { results, location, preFiltered: wasPreFiltered } = await outcome;
      if (wasPreFiltered) {
        preFiltered++;
        countFirst(j, 'preFiltered');
        // Reclassify treats pre-filtered jobs the same as base-filter rejects:
        // they leave the inbox.
        turnDown(j, chosen);
        continue;
      }
      if (results.size === 0) {
        failed++;
        countFirst(j, 'failed');
        continue;
      }

      const place = mergeAiLocation(storedPlace(j), location);
      const { verdicts, boosted } = buildVerdicts(results, profiles, j, place);
      const merged = mergeVerdicts(verdicts);
      if (!merged) {
        failed++;
        countFirst(j, 'failed');
        continue;
      }
      reclassified++;
      countFirst(j, 'reclassified');
      if (merged.kept) {
        matched++;
        countFirst(j, 'matched');
      }
      priorityBoosted += boosted;

      if (!merged.kept && merged.winner.dismissReason) {
        dismissedBy[DISMISS_KEY[merged.winner.dismissReason]]++;
        countFirst(j, DISMISS_KEY[merged.winner.dismissReason]);
      }
      const targetStatus = statusAfterRescore(j.status, merged.kept, chosen);

      await saveJobScores(j, merged, verdicts, targetStatus, place);

      if (targetStatus === j.status) unchanged++;
      else if (targetStatus === JobStatus.NEW) promoted++;
      else if (targetStatus === JobStatus.SAVED) keptSaved++;
      else demoted++;
    }
    if (demoteIds.length > 0) {
      await prisma.job.updateMany({ where: { id: { in: demoteIds } }, data: { status: JobStatus.DISMISSED } });
    }
    if (saveIds.length > 0) {
      await prisma.job.updateMany({ where: { id: { in: saveIds } }, data: { status: JobStatus.SAVED } });
    }
  }

  const durationMs = Date.now() - started;
  const stats = {
    profile: profiles.map((p) => p.name).join(' · '),
    classifierMode,
    concurrency: config.AI_CONCURRENCY,
    scanned,
    reclassified,
    preFiltered,
    promoted,
    demoted,
    keptSaved,
    unchanged,
    matched,
    filterRejected,
    ...dismissedBy,
    priorityBoosted,
    failed,
    lastError,
    durationMs,
  };
  logger.info(stats, 'reclassify-all: done');
  return { stats, firstScoring };
}
