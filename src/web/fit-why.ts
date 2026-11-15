import type { Job, Profile } from '@prisma/client';
import { fitBreakdown, readFitFacts, type CeilingKind, type FitBreakdown } from '../fit-score';
import { formatList } from '../i18n/format';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

/*
 * "Why this fit" on the job page (ADR 0064), worded from the facts a search's
 * row keeps and the search as it is now — the same arithmetic the number came
 * from, so the sentences cannot argue with it. Pure: no I/O, no AI.
 *
 * `shown` stays in sight (why the score is held under a ceiling, why the
 * number on file differs, what to do about a row with no facts — never folded,
 * docs/ui-redesign-plan.md §8); `folded` is the rest, fact by fact.
 */

export interface FitWhy {
  shown: string[];
  folded: string[];
}

type WhyProfile = Pick<Profile, 'stackRequired' | 'stackNiceToHave' | 'stackExclude' | 'roleTypes' | 'seniority' | 'minSalaryUsd'>;
type WhyJob = Pick<Job, 'title' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'>;
type WhyRow = { fitScore: number; fitFacts: unknown; priorityRulesApplied: string[] };

const CEILING: Record<CeilingKind, MessageKey> = {
  stackNone: 'job.fitWhy.ceiling.stackNone',
  roleAdjacent: 'job.fitWhy.ceiling.roleAdjacent',
  roleOther: 'job.fitWhy.ceiling.roleOther',
  seniorityMismatch: 'job.fitWhy.ceiling.seniorityMismatch',
  excluded: 'job.fitWhy.ceiling.excluded',
};

function stackLine(b: FitBreakdown): string {
  if (b.required === 0) return t('job.fitWhy.stackNotSet');
  const used = b.facts.stackUsed.length;
  if (b.facts.stackRole === 'none') return t('job.fitWhy.stackNone');
  return t(b.facts.stackRole === 'core' ? 'job.fitWhy.stackCore' : 'job.fitWhy.stackSecondary', { used, total: b.required });
}

function roleLine(b: FitBreakdown, accepts: boolean): string {
  if (b.facts.roleType === 'match') {
    return accepts ? t('job.fitWhy.roleMatch', { role: formatList(b.facts.roles) }) : t('job.fitWhy.roleAny');
  }
  return t(b.facts.roleType === 'adjacent' ? 'job.fitWhy.roleAdjacent' : 'job.fitWhy.roleOther');
}

const LEVEL: Record<FitBreakdown['facts']['seniority'], MessageKey> = {
  match: 'job.fitWhy.levelMatch',
  adjacent: 'job.fitWhy.levelAdjacent',
  mismatch: 'job.fitWhy.levelMismatch',
  unstated: 'job.fitWhy.levelUnstated',
};
const SALARY: Record<FitBreakdown['salary'], MessageKey> = {
  disclosed: 'job.fitWhy.salaryDisclosed',
  undisclosed: 'job.fitWhy.salaryUndisclosed',
  under: 'job.fitWhy.salaryUnder',
};
const OFF_STACK: Record<FitBreakdown['facts']['offStack'], MessageKey> = {
  none: 'job.fitWhy.offNone',
  some: 'job.fitWhy.offSome',
  most: 'job.fitWhy.offMost',
};

/** The sentences for one search's row on one posting. */
export function fitWhy(row: WhyRow, profile: WhyProfile, job: WhyJob): FitWhy {
  const stored = readFitFacts(row.fitFacts);
  if (!stored) return { shown: [t('job.fitWhy.beforeFacts')], folded: [] };
  const b = fitBreakdown(stored, job.title, profile, {
    salary_min: job.salaryMin,
    salary_max: job.salaryMax,
    salary_currency: job.salaryCurrency,
    salary_period: job.salaryPeriod,
  });
  const shown: string[] = [];
  if (b.ceiling) shown.push(t(CEILING[b.ceiling.kind], { ceiling: b.ceiling.value }));
  // A priority rule lifts the number on purpose, and its badge says so; anything else apart is the search having moved.
  if (row.priorityRulesApplied.length === 0 && b.fit !== row.fitScore) shown.push(t('job.fitWhy.drifted', { now: b.fit }));
  const folded = [
    stackLine(b),
    roleLine(b, profile.roleTypes.some((r) => r.trim().length > 0)),
    t(LEVEL[b.facts.seniority]),
    t(SALARY[b.salary]),
    ...(b.nice > 0 ? [t('job.fitWhy.nice', { n: b.facts.niceUsed.length })] : []),
    t(OFF_STACK[b.facts.offStack]),
    ...(b.facts.excluded.length > 0
      ? [t('job.fitWhy.excluded', { n: b.facts.excluded.length, signals: formatList(b.facts.excluded) })]
      : []),
  ];
  return { shown, folded };
}
