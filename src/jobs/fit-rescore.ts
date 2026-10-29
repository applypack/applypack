import type { Job, JobScore, Profile } from '@prisma/client';
import { readFitFacts, verdictFromFacts } from '../fit-score';
import type { ClassificationsByProfile } from '../classifier';
import { buildVerdicts, decideDismissReason, mergeVerdicts, type MergedVerdict, type ProfileVerdict } from './verdict-merge';
import type { StoredPlace } from './location-merge';

/*
 * ADR 0064: a posting's fit made again from the facts its rows keep, against
 * the searches as they are now — after a weight change in fit-score.ts or an
 * edit that only changes what the facts are compared with (a level added, a
 * skill moved between lists, a new floor). No model call: the reply is not
 * asked for again, so a search with no row (new since) and a row with no
 * facts (scored before v7) are left to Re-classify. Pure; the once-script
 * (scripts/rescore-fit-once.ts) reads and writes.
 */

export type RescoreJob = Pick<
  Job,
  'title' | 'description' | 'location' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'
>;
export type RescoreRow = Pick<JobScore, 'profileId' | 'fitScore' | 'locationMatch' | 'redFlags' | 'summary' | 'fitFacts'>;

/** One search's number before and after, and whether it crossed that search's floor. */
export interface RowChange {
  profileId: number;
  before: number;
  after: number;
  /** 'up': under the floor before, at or over it now; 'down' the other way. */
  crossed: 'up' | 'down' | null;
}

export interface Rescored {
  verdicts: ProfileVerdict[];
  merged: MergedVerdict;
  rows: RowChange[];
  /** Whether any search keeps the posting, before (the stored numbers, today's rules) and now. */
  keptBefore: boolean;
  keptNow: boolean;
}

/**
 * The posting's verdicts made again, or null when a row has no facts or its
 * search is gone — then nothing is half re-scored. Every step after the
 * number is the tick's own (`buildVerdicts`, `mergeVerdicts`), so a priority
 * rule, a group that opens the place and each search's floor apply as they
 * would to a fresh reply.
 */
export function rescoreFromFacts(
  job: RescoreJob,
  rows: RescoreRow[],
  profiles: ReadonlyMap<number, Profile>,
  place: StoredPlace,
): Rescored | null {
  if (rows.length === 0) return null;
  const searches: Profile[] = [];
  const results: ClassificationsByProfile = new Map();
  for (const row of rows) {
    const stored = readFitFacts(row.fitFacts);
    const profile = profiles.get(row.profileId);
    if (!stored || !profile) return null;
    searches.push(profile);
    results.set(
      row.profileId,
      verdictFromFacts(
        {
          location_match: row.locationMatch,
          salary_min: job.salaryMin,
          salary_max: job.salaryMax,
          salary_currency: job.salaryCurrency,
          salary_period: job.salaryPeriod,
          red_flags: row.redFlags,
          summary: row.summary ?? '',
        },
        stored,
        job.title,
        profile,
      ),
    );
  }
  const { verdicts } = buildVerdicts(results, searches, job, place);
  const merged = mergeVerdicts(verdicts);
  if (!merged) return null;

  const salary = { salary_min: job.salaryMin, salary_currency: job.salaryCurrency, salary_period: job.salaryPeriod };
  const wantedBefore = (row: RescoreRow, profile: Profile): boolean =>
    decideDismissReason({ ...salary, fit_score: row.fitScore, location_match: row.locationMatch }, profile) === null;
  const changes: RowChange[] = verdicts.map((v) => {
    const row = rows.find((r) => r.profileId === v.profileId)!;
    const floor = profiles.get(v.profileId)!.minFitScore;
    const after = v.classification.fit_score;
    const crossed = row.fitScore < floor && after >= floor ? 'up' : row.fitScore >= floor && after < floor ? 'down' : null;
    return { profileId: v.profileId, before: row.fitScore, after, crossed };
  });
  return {
    verdicts,
    merged,
    rows: changes,
    keptBefore: rows.some((row) => wantedBefore(row, profiles.get(row.profileId)!)),
    keptNow: merged.kept,
  };
}
