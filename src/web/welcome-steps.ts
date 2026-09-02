/*
 * The first-run wizard's state is derived from data, never stored
 * (docs/onboarding-plan.md §1, principle 2): a step is done when the thing
 * it produces exists. Pure — the route gathers the facts, the page renders
 * the first undone step. Tested in welcome-steps.test.ts.
 */

export const WELCOME_STEPS = ['ai', 'search', 'profile', 'matches'] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

export interface WelcomeFacts {
  /** At least one AI engine probes usable on this host. */
  aiReady: boolean;
  jobCount: number;
  /** The active profile lists a required stack or role types (issue #50). */
  profileReady: boolean;
  /** Jobs that carry a match score. */
  scoredCount: number;
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

export function isWelcomeStep(value: unknown): value is WelcomeStep {
  return typeof value === 'string' && (WELCOME_STEPS as readonly string[]).includes(value);
}

/** Flash line for a finished "Score the jobs we found" pass, from its CronRun stats. */
export function summarizeScoreRun(stats: Record<string, unknown>): { kind: 'ok' | 'warn'; text: string } {
  const n = (key: string): number => (typeof stats[key] === 'number' ? (stats[key] as number) : 0);
  if (stats.reason === 'blank-profile') {
    return { kind: 'warn', text: 'Scoring skipped — the profile lists no technologies or role words yet.' };
  }
  if (stats.reason === 'no-active-profile') {
    return { kind: 'warn', text: 'Scoring skipped — no running search. Create one in Settings → Profile.' };
  }
  const scored = n('reclassified');
  const matches = n('unchanged') + n('promoted');
  const parts = [`Scored ${scored} jobs — ${matches} look like a match`];
  if (n('filterDismissed') > 0) parts.push(`${n('filterDismissed')} set aside as off-topic without AI`);
  if (n('failed') > 0) parts.push(`${n('failed')} could not be scored`);
  if (n('remaining') > 0) parts.push(`${n('remaining')} more waiting for the next pass`);
  return { kind: scored === 0 && n('failed') > 0 ? 'warn' : 'ok', text: `${parts.join('; ')}.` };
}
