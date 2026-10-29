/*
 * The first-run wizard's state is derived from data, never stored
 * (docs/onboarding-plan.md §1, principle 2): a step is done when the thing
 * it produces exists. Pure — the route gathers the facts, the page renders
 * the first undone step. Tested in welcome-steps.test.ts.
 */
import { dismissedReasons, filteredReasons, funnelCounts, reasonsText } from '../funnel';
import { t } from '../i18n/t';
import { canonicalZone } from './time-zones';

export const WELCOME_STEPS = ['ai', 'search', 'profile', 'sources', 'matches'] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

export interface WelcomeFacts {
  /** At least one AI engine probes usable on this host. */
  aiReady: boolean;
  jobCount: number;
  /** The active profile lists a required stack or role types (issue #50). */
  profileReady: boolean;
  /** Jobs that carry a match score. */
  scoredCount: number;
  /** Sources that fit the running searches and are not on yet (#148). */
  sourcesWaiting: number;
  setupCompletedAt: Date | null;
}

export function stepDone(step: WelcomeStep, f: WelcomeFacts): boolean {
  switch (step) {
    case 'ai':
      return f.aiReady;
    case 'search':
      return f.jobCount > 0;
    case 'profile':
      return f.profileReady;
    case 'sources':
      // Not reached before there is a search: with none, nothing waits because
      // nothing was asked, and a tick there read as "done, skip it" (#643).
      // Skippable after that: a US search has nothing to add, and a user who
      // went on to score matches has passed it — neither should be nagged.
      return (f.profileReady && f.sourcesWaiting === 0) || f.scoredCount > 0;
    case 'matches':
      return f.scoredCount > 0;
  }
}

/** The first step still to do — null once every step is done. */
export function currentStep(f: WelcomeFacts): WelcomeStep | null {
  return WELCOME_STEPS.find((s) => !stepDone(s, f)) ?? null;
}

/** `/` sends a fresh install to /welcome until the wizard finishes or is skipped. */
export function needsWelcome(f: Pick<WelcomeFacts, 'setupCompletedAt'>): boolean {
  return f.setupCompletedAt === null;
}

/**
 * The zone setup keeps as it ends (#643): the browser's, when nobody chose
 * one — no schedule is stored and the install's TZ reads UTC, which the
 * default and `.env.example` both write. Until then every date, the last
 * check and the digest's hour read in UTC on a machine that is not. A zone
 * someone set, in Settings or in TZ, is theirs: null keeps it.
 */
export function setupZone(storedSchedule: unknown, installZone: string, browserZone: string): string | null {
  if (storedSchedule !== null && storedSchedule !== undefined) return null;
  if (canonicalZone(installZone) !== 'UTC') return null;
  const zone = canonicalZone(browserZone.trim());
  return zone === null || zone === 'UTC' ? null : zone;
}

export function isWelcomeStep(value: unknown): value is WelcomeStep {
  return typeof value === 'string' && (WELCOME_STEPS as readonly string[]).includes(value);
}

/** Flash line for a finished "Score the jobs we found" pass, from its CronRun stats. */
export function summarizeScoreRun(stats: Record<string, unknown>): { kind: 'ok' | 'warn'; text: string } {
  const n = (key: string): number => (typeof stats[key] === 'number' ? (stats[key] as number) : 0);
  if (stats.reason === 'blank-profile') {
    return { kind: 'warn', text: t('welcome.scoreRun.skippedBlank') };
  }
  if (stats.reason === 'no-active-profile') {
    return { kind: 'warn', text: t('welcome.scoreRun.skippedNoSearch') };
  }
  const scored = n('reclassified');
  const matches = n('unchanged') + n('promoted');
  const counts = funnelCounts(stats);
  // Why the rest did not match (N2): the winning search's reason, then the base filter's gate.
  const notMatched = reasonsText(dismissedReasons(counts));
  // Each clause is a whole message, with and without its reason; the line is the clauses that apply.
  const parts = [
    notMatched ? t('welcome.scoreRun.scoredWhy', { scored, matches, why: notMatched }) : t('welcome.scoreRun.scored', { scored, matches }),
  ];
  if (n('filterDismissed') > 0) {
    const why = reasonsText(filteredReasons(counts), { total: n('filterDismissed') });
    const set = { n: n('filterDismissed'), why };
    parts.push(why ? t('welcome.scoreRun.setAsideWhy', set) : t('welcome.scoreRun.setAside', set));
  }
  if (n('failed') > 0) {
    const failed = { n: n('failed'), error: typeof stats.lastError === 'string' ? stats.lastError : '' };
    parts.push(failed.error ? t('welcome.scoreRun.failedWhy', failed) : t('welcome.scoreRun.failedCount', failed));
  }
  if (n('remaining') > 0) parts.push(t('welcome.scoreRun.remaining', { n: n('remaining') }));
  return { kind: scored === 0 && n('failed') > 0 ? 'warn' : 'ok', text: `${parts.join('; ')}.` };
}
