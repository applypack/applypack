import { JobStatus, Prisma, type Job, type Profile } from '@prisma/client';
import { isUniqueViolation, prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { anyBaseFilterReason } from '../filter';
import { employerGate, hiringKey } from '../employer';
import { loadEmployerRules } from './employer-store';
import { DISMISS_KEY, FILTER_KEY } from '../funnel';
import { withApplyLinkFlags } from '../apply-link';
import { validDate } from '../fetchers/dates';
import { parseLocation } from '../location';
import { classifyJob, type ClassifyOutcome } from '../classifier';
import { buildVerdicts, mergeVerdicts, type ProfileVerdict } from './verdict-merge';
import { toScoreData } from './score-store';
import { mergeAiLocation, type StoredPlace } from './location-merge';
import { isBlankProfile, NO_PROFILE_STACK_FLAG } from '../profile-guards';
import { alertChannel, sendAlert, type Delivery } from '../notifier';
import { autoPacksToday, queuePack } from '../pack/store';
import { autoPack } from '../pack/trigger';
import { attributionLine } from '../web/pages/attribution';
import { getPackSettings, type ClassifierMode } from '../settings';
import { canAlertNow, type Schedule } from '../user-schedule';
import { alertsEveryPosting, starred, type WatchRules } from '../watchlist/interval';
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
  /** What the watchlist asks of this row (ADR 0036). Absent = the normal pipeline. */
  watch?: WatchRules;
  /** The source's alerts are off (a folder set so, ADR 0062): a match is kept and shown, and sends nothing. */
  quiet?: boolean;
}

/** A fetched row plus its parsed location and whose it is — read once, used by the gates and the insert. */
interface Candidate extends FetchResult {
  place: StoredPlace;
  /** employer.ts:hiringKey — the aggregator's employer, else the source; null when nobody said (ADR 0056). */
  employerKey: string | null;
}

export interface ProcessStats {
  filterRejected: number;
  duplicate: number;
  preFiltered: number;
  classified: number;
  classifyFailed: number;
  /** Why the last failed classification failed, in the provider's words (#97). */
  classifyError: string | null;
  persisted: number;
  dismissed: number;
  alerted: number;
  alertFailed: number;
  /** Matches an application pack was queued for (ADR 0063); 0 on every install that never switched packs on. */
  packsQueued: number;
  priorityBoosted: number;
  crossListed: number;
  /** 1 when the run stopped early because fetching was paused mid-run. */
  abortedMidRun: number;
  /** Classifications scheduled but discarded by the mid-run abort. */
  skippedByPause: number;
  /** 1 when the tick skipped classify+alerts because no usable search is active. */
  skippedBlankProfile: number;
  /** Matches scored outside the alert window; they wait for the next one (TASKS §16). */
  alertHeld: number;
  /** Matches scored while Alerts were switched off; they go out when they are back on. */
  alertsOffHeld: number;
  /** Matches with no active chat to send them to; they stay New on the dashboard. */
  alertNoTarget: number;
  /** Matches from a source whose alerts are off (ADR 0062): kept on /jobs, never sent. */
  alertSourceOff: number;
  /** Postings kept because a watched company alerts on everything (ADR 0036). */
  watchedKept: number;
  /** Stored as a match after scoring — kept by a search, or by a watched company's policy. */
  matched: number;
  /** The base filter's reject, by the gate that took it (filter.ts:FILTER_REASONS) — the search funnel's first half. */
  rejectedTitle: number;
  rejectedExcluded: number;
  rejectedWorkplace: number;
  rejectedPlace: number;
  /** Turned away by who hires, before any AI (ADR 0056): a muted company, or one applied to inside the window. */
  rejectedMuted: number;
  rejectedApplied: number;
  /** Dismissed by every search after scoring, by the winner's reason — the funnel's second half. */
  dismissedLowFit: number;
  dismissedLocation: number;
  dismissedSalary: number;
}

/** A tick's counters before it starts: every number at zero. */
export function emptyProcessStats(): ProcessStats {
  return {
    filterRejected: 0,
    duplicate: 0,
    preFiltered: 0,
    classified: 0,
    classifyFailed: 0,
    classifyError: null,
    persisted: 0,
    dismissed: 0,
    alerted: 0,
    alertFailed: 0,
    packsQueued: 0,
    priorityBoosted: 0,
    crossListed: 0,
    abortedMidRun: 0,
    skippedByPause: 0,
    skippedBlankProfile: 0,
    alertHeld: 0,
    alertsOffHeld: 0,
    alertNoTarget: 0,
    alertSourceOff: 0,
    watchedKept: 0,
    matched: 0,
    rejectedTitle: 0,
    rejectedExcluded: 0,
    rejectedWorkplace: 0,
    rejectedPlace: 0,
    rejectedMuted: 0,
    rejectedApplied: 0,
    dismissedLowFit: 0,
    dismissedLocation: 0,
    dismissedSalary: 0,
  };
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
  /**
   * When alerts may leave (TASKS §16). Read once per tick by the caller, so
   * every posting of one run is judged against the same instant. Absent =
   * send on the spot, which is what every caller did before the schedule
   * existed.
   */
  schedule?: Schedule;
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
  const { classifierMode, classify = true, isCancelled, schedule } = opts;
  const mayAlert = schedule === undefined || canAlertNow(new Date(), schedule);

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
  // One read for the whole tick instead of one per posting: 1 600 to 5 500
  // round trips on a cold tick were spent asking "is this stored?" one
  // (companyId, externalId) at a time (audit 2026-09-10, DATA-4).
  const stored = await storedKeys(items.map((i) => i.job));
  // Read once per tick, like the schedule: whom the user muted, and — with
  // the re-apply window on — where they applied inside it (ADR 0056).
  const employers = await loadEmployerRules();
  for (const item of items) {
    if (isCancelled && (await isCancelled())) {
      cancelled = true;
      break;
    }
    // The structured reading of the location string (ADR 0031): the source's
    // hints first, the parser for the rest. The filter compares its columns
    // with each search's (ADR 0032); the insert stores them as they are here.
    // A date that is not one would throw in the prompt and again in the
    // insert, and the row would come back every tick (FETCH-1). Every fetcher
    // reads dates through safeDate; this is the check for the one that forgets.
    if (Number.isNaN(item.job.postedAt.getTime())) {
      logger.warn({ title: item.job.title, companyName: item.companyName }, 'process-jobs: posting date unreadable, using now');
      item.job.postedAt = validDate(item.job.postedAt);
    }
    const place = parseLocation(item.job.location, item.job.locationHints);
    // A posting is admitted when ANY active search admits it (ADR 0028).
    // Storing unscored keeps the UNFILTERED roster on purpose: the wizard's
    // step 2 runs "Fetch now" before step 3 creates a profile, so at that
    // moment every search is blank — and a blank search's gate admits
    // everything, which is what makes the fresh-install run show results.
    // A watched company set to "every posting" is the user saying they want
    // to SEE what appears there, so the roster's gate does not apply to it.
    // The posting is still classified below — the policy decides what is done
    // with the verdict, not whether one is formed (ADR 0036).
    // A posting the user saved themselves is taken as a paste is (ADR 0062):
    // they chose it, so no search's filter and no employer rule turns it away.
    const chosen = item.job.handPicked === true;
    const rejected = chosen || alertsEveryPosting(item.watch)
      ? null
      : anyBaseFilterReason({ ...item.job, ...place }, classify ? profiles : activeProfiles);
    // Who hires, before any AI: a muted company, or one applied to inside the
    // re-apply window, is turned away like a filter reject — no row, no call.
    // Reversible: after an unmute the next tick meets the posting as new.
    const employerKey = hiringKey(item.job.employer, item.companyName, item.job.employer !== undefined);
    const turnedAway = rejected ?? (chosen ? null : employerGate(employerKey, employers, alertsEveryPosting(item.watch)));
    if (turnedAway !== null) {
      stats.filterRejected++;
      stats[FILTER_KEY[turnedAway]]++;
      continue;
    }
    const key = `${item.job.companyId}:${item.job.externalId}`;
    if (seen.has(key) || stored.has(pairKey(item.job))) {
      stats.duplicate++;
      continue;
    }
    seen.add(key);
    candidates.push({ ...item, place, employerKey });
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

  // Read once, like the schedule: Alerts off with a chat to send to means a
  // match waits for them; no chat at all means there is nothing to wait for.
  const channel = await alertChannel();
  // Read once as well: whether a strong new match gets an application pack
  // (ADR 0063), and how many today's limit has left.
  const packs = await getPackSettings();
  let packsToday = packs.enabled ? await autoPacksToday(new Date()) : 0;

  // Classify up to AI_CONCURRENCY jobs at once; results are consumed in the
  // original order, so persisting and alerting stay sequential and ordered.
  const limit = createLimiter(config.AI_CONCURRENCY);
  const pending = candidates.map((item) => ({
    ...item,
    outcome: limit(async (): Promise<ClassifyOutcome> => {
      if (cancelled) return { results: new Map(), location: null, preFiltered: false };
      return classifyJob(
        // The employer an aggregator named, not the feed's own name (ADR 0056).
        buildClassifyInput(item.job, item.job.employer ?? item.companyName, item.place),
        profiles,
        classifierMode,
        (reason) => {
          stats.classifyError = reason;
        },
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
    const { results, location, preFiltered, prefilterReason } = await outcome;
    // The model read the whole description; where it knows more than the
    // location line said, the row is stored with that (ADR 0032).
    const placed: Candidate = { ...item, place: mergeAiLocation(item.place, location) };
    if (preFiltered) {
      stats.preFiltered++;
      // Stored, dismissed and unscored, with the prefilter's reason: unstored,
      // the next tick met it as new and paid the prefilter again, every hour it
      // stayed on its feed (#290). "Save & re-classify" still reads it.
      await persistJob(placed, null, JobStatus.DISMISSED, [], batch, {
        summary: prefilterReason ? `Set aside by the prefilter: ${prefilterReason}` : 'Set aside by the prefilter.',
      });
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
    const { winner, scoreLine } = merged;
    const finalClassification = winner.classification;
    // Every search dismissed it, but the user asked to be shown everything
    // this company posts. The row is kept and alerted; the message says
    // "new posting", not "match", so it never claims a score it does not have.
    const keptByPolicy = !merged.kept && alertsEveryPosting(item.watch);
    const kept = merged.kept || keptByPolicy;

    if (!kept) {
      // A posting the user saved is theirs to keep whatever the score says: Saved, as a paste is,
      // with the verdicts that explain it — never Dismissed, which is deleted after a month.
      const status = job.handPicked === true ? JobStatus.SAVED : JobStatus.DISMISSED;
      const stored = await persistJob(placed, finalClassification, status, winner.priorityRulesApplied, batch, {
        verdicts,
      });
      if (stored) {
        stats.dismissed++;
        if (winner.dismissReason) stats[DISMISS_KEY[winner.dismissReason]]++;
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

    // Whether the alert is skipped (issue #50) or held — for the window, or
    // while Alerts are off — is known before the row exists, so the held
    // stamp is written WITH the row: a second statement could leave a NEW
    // match with no stamp, which nothing would ever send (audit 2026-09-10,
    // DATA-3).
    const skipsAlert =
      finalClassification.red_flags.includes(NO_PROFILE_STACK_FLAG) && !alertsEveryPosting(item.watch);
    const holds = !skipsAlert && item.quiet !== true && channel !== 'no-targets' && (!mayAlert || channel === 'alerts-off');
    const alertHeldAt = holds ? new Date() : null;
    const stored = await persistJob(placed, finalClassification, JobStatus.NEW, winner.priorityRulesApplied, batch, {
      verdicts,
      alertHeldAt,
    });
    if (!stored) continue;
    stats.matched++;
    const { created, crossListing } = stored;
    // Asked here and nowhere else — about a posting this tick has just
    // stored — so the backlog is never walked and a re-classify queues
    // nothing (pack/trigger.ts). The runner picks the row up (pack-job.ts).
    if (
      !skipsAlert &&
      autoPack({ settings: packs, fit: created.fitScore, postedAt: created.postedAt, now: new Date(), queuedToday: packsToday }) === 'queue'
    ) {
      // A pack is an extra: failing to queue one must never cost the match its alert.
      try {
        await queuePack(created.id, 'auto');
        packsToday++;
        stats.packsQueued++;
      } catch (err) {
        logger.warn({ err, jobId: created.id }, 'process-jobs: could not queue an application pack');
      }
    }
    // Counted where every other counter is: after the row exists. A posting
    // the unique key rejected was not kept by anything.
    if (keptByPolicy) stats.watchedKept++;

    // A score produced without a required stack never alerts, whatever the
    // threshold or priority boosts say (issue #50). The row stays NEW.
    // A watched company on "every posting" is the exception: that flag is a
    // statement about the SCORE, and this alert makes no claim about the
    // score — it says a company the user chose has put something up.
    if (skipsAlert) continue;

    // The source's own alerts are off: the match is on /jobs with its score, and nothing is sent or held.
    if (item.quiet === true) {
      stats.alertSourceOff++;
      continue;
    }

    // No chat to send to: the row stays NEW on the dashboard, which is where
    // an install without notifications reads its matches. Nothing is held,
    // so adding a chat later does not replay the backlog.
    if (channel === 'no-targets') {
      stats.alertNoTarget++;
      continue;
    }

    // Outside the alert window, or while Alerts are off, the match is kept,
    // not dropped: the row is NEW with its verdicts and its held stamp already
    // stored, and the first heartbeat that may send it does, in one grouped
    // message instead of twelve at 03:00.
    if (alertHeldAt) {
      if (channel === 'alerts-off') stats.alertsOffHeld++;
      else stats.alertHeld++;
      continue;
    }

    let delivery: Delivery;
    try {
      delivery = await sendAlert(
        {
          title: created.title,
          companyName: starred(job.employer ?? companyName, item.watch),
          watched: item.watch?.watched === true,
          attribution: job.sourceFile
            ? `From your folder: ${companyName} / ${job.sourceFile}`
            : item.source
              ? attributionLine(item.source.atsType, item.source.atsToken)
              : null,
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
        winner.notificationTargetId,
      );
    } catch (err) {
      // Every chat refused it. Held, so the next heartbeat sends it with the
      // others in one grouped message instead of never.
      stats.alertFailed++;
      logger.error(
        { err, jobId: created.id, title: created.title },
        'process-jobs: alert failed; held for the next heartbeat',
      );
      await holdAlert(created.id);
      continue;
    }
    if (delivery.skipped === null) {
      // Still NEW, exactly as the held-alert path checks: the send
      // takes seconds and the dashboard is open the whole time. A row the
      // user dismissed or saved in between keeps their status — the message
      // is out either way, and overwriting their answer is the worse loss.
      await prisma.job.updateMany({
        where: { id: created.id, status: JobStatus.NEW },
        data: { status: JobStatus.ALERTED, alertedAt: new Date() },
      });
      stats.alerted++;
    } else if (delivery.skipped === 'alerts-off') {
      // Switched off since the tick read the switch: this one waits too.
      await holdAlert(created.id);
      stats.alertsOffHeld++;
    } else {
      stats.alertNoTarget++;
    }
  }
}

/** Stamps a NEW match for the grouped delivery (`alert-delivery.ts`); a row the user already answered keeps their status. */
async function holdAlert(id: number): Promise<void> {
  await prisma.job.updateMany({ where: { id, status: JobStatus.NEW }, data: { alertHeldAt: new Date() } });
}

function pairKey(job: Pick<NormalizedJob, 'companyId' | 'externalId'>): string {
  return `${job.companyId}\u0000${job.externalId}`;
}

/**
 * The (companyId, externalId) pairs already in the table, for a batch. The
 * query asks for any company of the batch × any external id of the batch —
 * a superset — and the Set holds the exact pairs, so a collision of
 * external ids across two boards cannot mark a new posting as stored.
 */
async function storedKeys(jobs: Pick<NormalizedJob, 'companyId' | 'externalId'>[]): Promise<Set<string>> {
  if (jobs.length === 0) return new Set();
  const rows = await prisma.job.findMany({
    where: {
      companyId: { in: [...new Set(jobs.map((j) => j.companyId))] },
      externalId: { in: [...new Set(jobs.map((j) => j.externalId))] },
    },
    select: { companyId: true, externalId: true },
  });
  return new Set(rows.map(pairKey));
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
  { job, companyName, place, employerKey }: Candidate,
  c: ClaudeClassification | null,
  status: JobStatus,
  priorityRulesApplied: string[],
  { stats, recentFingerprints }: Batch,
  {
    verdicts = [],
    alertHeldAt = null,
    summary = null,
  }: {
    verdicts?: ProfileVerdict[];
    alertHeldAt?: Date | null;
    /** A row stored without a classification still says why it was set aside. */
    summary?: string | null;
  } = {},
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
        ...(summary !== null && c === null && { summary }),
        employer: job.employer ?? null,
        employerKey,
        sourceFile: job.sourceFile ?? null,
        alertHeldAt,
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
    if (isUniqueViolation(err)) {
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
