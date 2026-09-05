import type { Job, Profile } from '@prisma/client';
import { toUsdPerYear } from '../currency';
import { applyPriorityFloor, parsePriorityRules } from '../priority-rules';
import type { ClaudeClassification } from '../types';
import type { ClassificationsByProfile } from '../classifier';

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
 */
export function buildVerdicts(
  results: ClassificationsByProfile,
  profiles: Profile[],
  job: Pick<Job, 'title' | 'description' | 'location'>,
): { verdicts: ProfileVerdict[]; boosted: number } {
  const verdicts: ProfileVerdict[] = [];
  let boosted = 0;
  for (const profile of profiles) {
    const raw = results.get(profile.id);
    if (!raw) continue;
    const priority = applyPriorityFloor(raw, parsePriorityRules(profile.priorityRules), job);
    if (priority.applied.length > 0) boosted++;
    verdicts.push({
      profileId: profile.id,
      profileName: profile.name,
      classification: priority.classification,
      dismissReason: decideDismissReason(priority.classification, profile),
      priorityRulesApplied: priority.applied.map((r) => r.label),
      notificationTargetId: profile.notificationTargetId,
    });
  }
  return { verdicts, boosted };
}

/** Would THIS search drop the posting? Its own threshold, its own regions. */
export function decideDismissReason(
  c: ClaudeClassification,
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
