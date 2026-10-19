import type { JobScore, Profile } from '@prisma/client';
import type { AiProviderId } from '../ai-engine';
import { decideDismissReason, type ProfileVerdict } from '../jobs/verdict-merge';
import { formatNumber } from '../i18n/format';
import { t } from '../i18n/t';

/*
 * The engine trial (#412): a sample of the postings already scored, read
 * again on one engine and one model, beside the scores on record. What is
 * read, how two readings are told apart and what the report says are here,
 * pure; engine-trial-run.ts makes the calls and keeps the result.
 */

/** How many postings a trial reads again, and the fewest scored ones it needs to be worth a run. */
export const TRIAL_SIZE = 20;
export const TRIAL_MIN = 5;
/** The classifier's own fit bands (classifier.ts, SCORING GUIDANCE), each by its floor, best first. */
const FIT_BANDS = [90, 70, 40, 0] as const;
const DISTANCE_FORMAT = { maximumFractionDigits: 1 } as const;
const SECONDS_FORMAT = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

/**
 * Up to `size` postings spread across the fit bands: one from each band in
 * turn, best band first, so a sample of mostly low scores still holds the few
 * kept ones. `newestFirst` keeps its order inside a band.
 */
export function pickTrialSample<T extends { fitScore: number }>(newestFirst: readonly T[], size = TRIAL_SIZE): T[] {
  const bands = FIT_BANDS.map((floor, i) => newestFirst.filter((row) => row.fitScore >= floor && (i === 0 || row.fitScore < FIT_BANDS[i - 1]!)));
  const picked: T[] = [];
  while (picked.length < size && bands.some((band) => band.length > 0)) {
    for (const band of bands) {
      const next = band.shift();
      if (next && picked.length < size) picked.push(next);
    }
  }
  return picked;
}

/** One search's verdict on record, judged by that search's threshold as it stands today. */
export interface RecordedVerdict {
  profileId: number;
  fit: number;
  kept: boolean;
  /** Scored before the search was last changed: a changed search changes the score. */
  stale: boolean;
  /** Written by the engine and model on trial: the comparison then measures how steady it is, not how it differs. */
  sameModel: boolean;
}

/** Who wrote a posting's scores on record: the latest scoring call the ledger holds for it. */
export interface RecordAuthor {
  engine: string;
  model: string;
}

/** The ledger's scoring calls, newest first → the author of each posting's record. */
export function recordAuthors(calls: readonly (RecordAuthor & { jobId: number | null })[]): Map<number, RecordAuthor> {
  const authors = new Map<number, RecordAuthor>();
  for (const call of calls) {
    if (call.jobId !== null && !authors.has(call.jobId)) authors.set(call.jobId, { engine: call.engine, model: call.model });
  }
  return authors;
}

/**
 * The scores on record for one posting. The salary is the posting's, as the
 * winning reply read it — the one figure a per-search row does not keep.
 */
export function recordedVerdicts(
  job: { salaryMin: number | null; salaryCurrency: string | null; salaryPeriod: string | null },
  scores: readonly Pick<JobScore, 'profileId' | 'fitScore' | 'locationMatch' | 'scoredAt'>[],
  profiles: readonly Pick<Profile, 'id' | 'minFitScore' | 'minSalaryUsd' | 'updatedAt'>[],
  sameModel = false,
): RecordedVerdict[] {
  return scores.flatMap((score) => {
    const profile = profiles.find((p) => p.id === score.profileId);
    if (!profile) return [];
    const reason = decideDismissReason(
      {
        fit_score: score.fitScore,
        location_match: score.locationMatch,
        salary_min: job.salaryMin,
        salary_currency: job.salaryCurrency,
        salary_period: job.salaryPeriod,
      },
      profile,
    );
    return [{ profileId: profile.id, fit: score.fitScore, kept: reason === null, stale: score.scoredAt < profile.updatedAt, sameModel }];
  });
}

/** One posting and one search: what the engine on trial made of it, beside the record. */
export interface TrialPair {
  fit: number;
  kept: boolean;
  record: RecordedVerdict;
}

/** The searches both sides judged; one the reply skipped, or the record lacks, is not compared. */
export function trialPairs(
  candidate: readonly Pick<ProfileVerdict, 'profileId' | 'classification' | 'dismissReason'>[],
  recorded: readonly RecordedVerdict[],
): TrialPair[] {
  return candidate.flatMap((v) => {
    const record = recorded.find((r) => r.profileId === v.profileId);
    return record ? [{ fit: v.classification.fit_score, kept: v.dismissReason === null, record }] : [];
  });
}

/** One posting read again: no answer, an answer that is no score, or the pairs it gave. */
export type TrialReading = { kind: 'failed' } | { kind: 'unparsed'; ms: number } | { kind: 'read'; ms: number; pairs: TrialPair[] };

export interface TrialReport {
  /** Postings asked about. */
  postings: number;
  /** Posting × search pairs both sides judged. */
  compared: number;
  /** Kept or turned away as the record did. */
  agreed: number;
  /** Kept by the engine on trial, turned away on record. */
  falseMatches: number;
  /** Kept on record, turned away by the engine on trial. */
  missed: number;
  /** Mean |fit − fit on record| over the pairs; null with none. */
  meanDistance: number | null;
  /** The middle call's time among those that answered; null with none. */
  msPerPosting: number | null;
  unparsed: number;
  failed: number;
  /** Pairs whose record predates the last change to its search. */
  stale: number;
  /** Pairs whose record the engine and model on trial wrote themselves. */
  sameModel: number;
}

export function trialReport(readings: readonly TrialReading[]): TrialReport {
  const pairs = readings.flatMap((r) => (r.kind === 'read' ? r.pairs : []));
  const times = readings.flatMap((r) => (r.kind === 'failed' ? [] : [r.ms])).sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  const distance = pairs.reduce((sum, p) => sum + Math.abs(p.fit - p.record.fit), 0);
  return {
    postings: readings.length,
    compared: pairs.length,
    agreed: pairs.filter((p) => p.kept === p.record.kept).length,
    falseMatches: pairs.filter((p) => p.kept && !p.record.kept).length,
    missed: pairs.filter((p) => !p.kept && p.record.kept).length,
    meanDistance: pairs.length > 0 ? Math.round((distance / pairs.length) * 10) / 10 : null,
    msPerPosting: times.length === 0 ? null : times.length % 2 === 1 ? times[mid]! : Math.round((times[mid - 1]! + times[mid]!) / 2),
    unparsed: readings.filter((r) => r.kind === 'unparsed').length,
    failed: readings.filter((r) => r.kind === 'failed').length,
    stale: pairs.filter((p) => p.record.stale).length,
    sameModel: pairs.filter((p) => p.record.sameModel).length,
  };
}

/**
 * The model a trial reads with, worded: an empty slot is a CLI's own default,
 * and on the local engine no model at all, so there is nothing to try (#563).
 */
export function trialModel(id: AiProviderId, model: string): string | null {
  if (model) return model;
  return id === 'local_api' ? null : t('ai.cliDefault');
}

/** True once a run has nothing left to learn: every call so far unanswered, and enough of them to say so. */
export function trialGivesUp(readings: readonly TrialReading[], after: number): boolean {
  return readings.length >= after && readings.every((r) => r.kind === 'failed');
}

/** The report in sentences: the agreement, the time, then what could not be compared and why it may differ. */
export function trialLine(report: TrialReport): string {
  const sentences = [
    report.compared > 0
      ? t('trial.result.agreement', {
          agreed: report.agreed,
          compared: report.compared,
          falseMatches: report.falseMatches,
          missed: report.missed,
          distance: formatNumber(report.meanDistance ?? 0, DISTANCE_FORMAT),
        })
      : t('trial.result.nothingCompared'),
    ...(report.sameModel === 0
      ? []
      : [report.sameModel === report.compared ? t('trial.result.sameModelAll') : t('trial.result.sameModelSome', { n: report.sameModel })]),
    ...(report.msPerPosting === null ? [] : [t('trial.result.speed', { seconds: formatNumber(report.msPerPosting / 1000, SECONDS_FORMAT) })]),
    ...(report.unparsed > 0 ? [t('trial.result.unparsed', { n: report.unparsed })] : []),
    ...(report.failed > 0 ? [t('trial.result.failed', { n: report.failed })] : []),
    ...(report.stale > 0 ? [t('trial.result.stale', { n: report.stale })] : []),
  ];
  return sentences.join(' ');
}
