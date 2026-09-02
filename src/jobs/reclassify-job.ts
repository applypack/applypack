import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { classifyJob } from '../classifier';
import { passesAnyBaseFilter } from '../filter';
import { getActiveProfile, listActiveProfiles } from '../profiles';
import { getSettings } from '../settings';
import { isBlankProfile } from '../profile-guards';
import { buildVerdicts, mergeVerdicts } from './verdict-merge';
import { saveJobScores } from './score-store';
import { rankByProfileFit, SCORE_BATCH, type ScorableJob } from './score-pick';

export { SCORE_BATCH };
import type { CronStats } from './cron-run';

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
 * every search rejects them.
 */
export async function runReclassifyAll(): Promise<{ stats: CronStats }> {
  return reclassify({});
}

/**
 * The wizard's step 4: jobs a paused "Fetch now" stored unscored get their
 * score against the profile that now exists. Rows failing the base filter
 * are dismissed in one update — no AI spent on them; of the rest, the
 * `limit` best matches by rankByProfileFit are classified (the wizard reads
 * the most promising ten, not the ten most recent), and `remaining` says
 * how many a second press would take.
 */
export async function runScoreUnscored(
  opts: Pick<ReclassifyOptions, 'onProgress'> & { limit?: number } = {},
): Promise<{ stats: CronStats }> {
  const profiles = (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
  if (profiles.length === 0) return { stats: { aborted: 1, reason: 'no-active-profile' } };
  // The wizard reads the most promising ten, and "promising" needs one
  // yardstick — the primary's, falling back to the first running search.
  const primary = (await getActiveProfile()) ?? profiles[0]!;
  const ranker = isBlankProfile(primary) ? profiles[0]! : primary;

  const unscored = await prisma.job.findMany({
    where: { fitScore: null, status: JobStatus.NEW },
    select: { id: true, title: true, location: true, description: true, fetchedAt: true },
  });
  const rejectedIds: number[] = [];
  const passing: ScorableJob[] = [];
  for (const j of unscored) {
    if (passesAnyBaseFilter(j, profiles)) passing.push(j);
    else rejectedIds.push(j.id);
  }
  if (rejectedIds.length > 0) {
    await prisma.job.updateMany({
      where: { id: { in: rejectedIds } },
      data: { status: JobStatus.DISMISSED },
    });
  }
  const ranked = rankByProfileFit(passing, ranker);
  const ids = ranked.slice(0, opts.limit ?? SCORE_BATCH).map((r) => r.id);
  const { stats } = await reclassify({ ids, onProgress: opts.onProgress });
  return {
    stats: {
      ...stats,
      unscored: unscored.length,
      filterDismissed: rejectedIds.length,
      remaining: ranked.length - ids.length,
    },
  };
}

async function reclassify(opts: ReclassifyOptions): Promise<{ stats: CronStats }> {
  const started = Date.now();
  // Issue #50: re-scoring against a blank search would overwrite real scores
  // with vibes-based ones and demote most of the inbox, so blank rows are
  // dropped from the roster rather than aborting the pass.
  const profiles = (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
  if (profiles.length === 0) {
    logger.warn('reclassify-all: no usable active search');
    return { stats: { aborted: 1, reason: 'no-active-profile' } };
  }

  const { classifierMode } = await getSettings();
  const scope = { status: { not: JobStatus.APPLIED }, ...(opts.ids && { id: { in: opts.ids } }) };
  const total = opts.ids ? opts.ids.length : await prisma.job.count({ where: scope });
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
        ...scope,
        id: { ...scope.id, gt: lastId },
      },
      include: { company: { select: { name: true, atsType: true } } },
      orderBy: { id: 'asc' },
      take: RECLASSIFY_BATCH_SIZE,
    });
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;

    // Jobs no active search admits skip Claude entirely; the rest are
    // classified AI_CONCURRENCY at a time and persisted in id order as their
    // results come in.
    const pending = batch.map((j) => ({
      job: j,
      outcome: passesAnyBaseFilter(j, profiles)
        ? limit(() =>
            classifyJob(
              {
                title: j.title,
                companyName: j.company.name,
                location: j.location,
                description: j.description,
                postedAt: j.postedAt,
              },
              profiles,
              classifierMode,
            ),
          )
        : null,
    }));

    for (const { job: j, outcome } of pending) {
      scanned++;
      opts.onProgress?.(scanned, total);

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

      const { results, preFiltered: wasPreFiltered } = await outcome;
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
      if (results.size === 0) {
        failed++;
        continue;
      }

      const { verdicts, boosted } = buildVerdicts(results, profiles, j);
      const merged = mergeVerdicts(verdicts);
      if (!merged) {
        failed++;
        continue;
      }
      reclassified++;
      priorityBoosted += boosted;

      const previousStatus = j.status;
      const targetStatus = !merged.kept
        ? JobStatus.DISMISSED
        : previousStatus === JobStatus.DISMISSED
          ? JobStatus.NEW
          : previousStatus;

      await saveJobScores(j, merged, verdicts, targetStatus);

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
    profile: profiles.map((p) => p.name).join(' · '),
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
