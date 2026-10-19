import type { Job, Profile } from '@prisma/client';
import { countriesOf } from '../countries';
import { toUsdPerYear } from '../currency';
import { placesOverlap } from '../filter';
import { applyPriorityFloor, parsePriorityRules } from '../priority-rules';
import type { ClaudeClassification } from '../types';
import type { ClassificationsByProfile } from '../classifier';
import type { StoredPlace } from './location-merge';

/*
 * ADR 0028: one posting, one verdict per active search. `Job` still carries a
 * single score, summary and flag list, because every list, badge, sort and
 * digest in the product reads them — so something has to decide which search
 * speaks for the row. That decision is here: pure, so it is unit-tested rather
 * than inferred from a persist path.
 */

export type DismissReason = 'low-fit' | 'location-mismatch' | 'low-salary';

/** What one search made of one posting. */
export interface ProfileVerdict {
  profileId: number;
  profileName: string;
  classification: ClaudeClassification;
  /** null when this search wants the posting. */
  dismissReason: DismissReason | null;
  priorityRulesApplied: string[];
  /** Where this search's alerts go; null = broadcast to all active targets. */
  notificationTargetId: number | null;
}

export interface MergedVerdict {
  /** The search whose numbers land on the Job row. */
  winner: ProfileVerdict;
  /** True when at least one search wants the posting. */
  kept: boolean;
  /** Every search, best first: "Backend 87 · QA 41". */
  scoreLine: string;
}

/**
 * The winner is the search that wanted the posting most — highest fit among
 * those that did NOT dismiss it. Ranking by raw fit instead would let a search
 * that scored 85 and then dismissed on a country lock put its summary on a row
 * another search is keeping, so the visible verdict would contradict the status.
 * When every search dismissed, the highest fit wins: the row is going to
 * DISMISSED either way, and the best of the rejections is the most useful thing
 * to show if someone opens it.
 *
 * Ties break on profile id, so a re-classify over the same scores is stable.
 */
export function mergeVerdicts(verdicts: ProfileVerdict[]): MergedVerdict | null {
  if (verdicts.length === 0) return null;

  const kept = verdicts.filter((v) => v.dismissReason === null);
  const winner = best(kept.length > 0 ? kept : verdicts);

  return {
    winner,
    kept: kept.length > 0,
    scoreLine: [...verdicts]
      .sort(byFitThenId)
      .map((v) => `${v.profileName} ${v.classification.fit_score}`)
      .join(' · '),
  };
}

function byFitThenId(a: ProfileVerdict, b: ProfileVerdict): number {
  return b.classification.fit_score - a.classification.fit_score || a.profileId - b.profileId;
}

function best(verdicts: ProfileVerdict[]): ProfileVerdict {
  return [...verdicts].sort(byFitThenId)[0]!;
}

/**
 * Turn one shared reply into a verdict per search: each search's own priority
 * rules lift its own score, and each search's own thresholds decide whether it
 * wants the posting. Pure, and the only place those two steps live — the fetch
 * tick, "Re-classify" and the per-job button all read from here, so a rule
 * change cannot apply in one path and not the others.
 *
 * Searches with no entry in the reply are skipped rather than defaulted: a
 * missing verdict is missing information, and inventing a zero would dismiss
 * a posting nobody judged.
 *
 * `place` is the posting's place as it will be stored, the model's reading
 * merged in (location-merge.ts).
 */
export function buildVerdicts(
  results: ClassificationsByProfile,
  profiles: Profile[],
  job: Pick<Job, 'title' | 'description' | 'location'>,
  place: StoredPlace,
): { verdicts: ProfileVerdict[]; boosted: number } {
  const verdicts: ProfileVerdict[] = [];
  let boosted = 0;
  for (const profile of profiles) {
    const raw = results.get(profile.id);
    if (!raw) continue;
    const priority = applyPriorityFloor(raw, parsePriorityRules(profile.priorityRules), job);
    if (priority.applied.length > 0) boosted++;
    const classification =
      !priority.classification.location_match && openThroughGroup(place, profile)
        ? { ...priority.classification, location_match: true }
        : priority.classification;
    verdicts.push({
      profileId: profile.id,
      profileName: profile.name,
      classification,
      dismissReason: decideDismissReason(classification, profile),
      priorityRulesApplied: priority.applied.map((r) => r.label),
      notificationTargetId: profile.notificationTargetId,
    });
  }
  return { verdicts, boosted };
}

/**
 * Whether a remote posting's own place proves it open to the search (#530):
 * a group it names holds a country the search hunts in (EUROPE holds PL), or
 * the whole of a group the search hunts in. The model wrote "remote EUROPE
 * excludes PL/DE" and dismissed a 92 for it, so the code overrules its
 * `location_match: false` here, as ADR 0045 does for presence.
 *
 * Only where the columns settle it: never WORLDWIDE (proves no country),
 * never a place the model itself changed (`source: 'ai'` — it read a narrower
 * one in the description), and when the search says where the candidate
 * lives, only for a group that holds that country inside the search's own
 * places — elsewhere, work rights are the model's call (ADR 0033).
 */
export function openThroughGroup(place: StoredPlace, profile: GroupProfile): boolean {
  return openingGroup(place, profile) !== null;
}

type GroupProfile = Pick<Profile, 'countries' | 'regions' | 'workplace' | 'residence'>;

/**
 * The group that opens a remote posting to the search, as `openThroughGroup`
 * decides it, and the search's places it holds — the residence alone when the
 * search names one. Read again on the job page from the stored place, so the
 * page can say why beside a summary that may say the opposite (#605).
 */
export function openingGroup(
  place: Pick<StoredPlace, 'workplace' | 'regions'> & { source: string | null },
  profile: GroupProfile,
): { group: string; places: string[] } | null {
  if (place.workplace !== 'REMOTE' || place.source === 'ai') return null;
  if (profile.workplace.length > 0 && !profile.workplace.includes('REMOTE')) return null;
  const residence = profile.residence ?? null;
  if (residence !== null && !placesOverlap({ countries: [residence], regions: [] }, profile)) return null;
  for (const group of place.regions) {
    if (group === 'WORLDWIDE') continue;
    const members = countriesOf(group);
    const places =
      residence !== null
        ? [residence].filter((c) => members.includes(c))
        : [
            ...profile.countries.filter((c) => members.includes(c)),
            ...profile.regions.filter((g) => g === group || countriesOf(g).every((c) => members.includes(c))),
          ];
    if (places.length > 0) return { group, places };
  }
  return null;
}

/** Would THIS search drop the posting? Its own threshold, its own regions. */
export function decideDismissReason(
  c: Pick<ClaudeClassification, 'fit_score' | 'location_match' | 'salary_min' | 'salary_currency' | 'salary_period'>,
  profile: Pick<Profile, 'minFitScore' | 'minSalaryUsd'>,
): DismissReason | null {
  if (c.fit_score < profile.minFitScore) return 'low-fit';
  if (!c.location_match) return 'location-mismatch';
  // The posting may quote złoty a month; the target is USD a year. One
  // pure conversion decides, with the rate table src/currency.ts dates.
  const salaryUsd = toUsdPerYear(c.salary_min, c.salary_currency, c.salary_period);
  if (profile.minSalaryUsd > 0 && salaryUsd !== null && salaryUsd < profile.minSalaryUsd) {
    return 'low-salary';
  }
  return null;
}
