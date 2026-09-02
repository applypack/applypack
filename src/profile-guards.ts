import type { ClaudeClassification } from './types';

/**
 * Guards against classifying with a blank profile (issue #50): when the
 * active profile constrains nothing, the base filter's title gate turns off
 * and the classifier prompt loses every stack rule, so it scores generic
 * job quality — 90+ for roles the candidate can't do. Pure module; the
 * worker, the classifier and the settings routes all decide through it.
 */

/**
 * How many searches may run at once (ADR 0028). Not a model limit — replies
 * stayed complete and discriminating through 12 — but a user-experience one:
 * per-posting latency grows ~0.6 s and output ~100 tokens per search, and
 * eight is where a "Fetch now" still feels immediate.
 */
export const MAX_ACTIVE_PROFILES = 8;

/** Red flag stamped on classifications made without a required stack. */
export const NO_PROFILE_STACK_FLAG = 'no-profile-stack';

/** A score produced with no stack to match against cannot exceed this. */
export const NO_STACK_FIT_CAP = 50;

/** The two fields every guard decision is based on. */
export interface GuardableProfile {
  stackRequired: string[];
  roleTypes: string[];
}

function hasEntries(list: string[]): boolean {
  return list.some((s) => s.trim().length > 0);
}

/**
 * True when the profile has no required stack AND no role types — nothing
 * for `passesBaseFilter` or the classifier to gate on. Blank profiles are
 * never auto-activated, refuse manual activation, and make the worker skip
 * classification + alerts for the tick.
 */
export function isBlankProfile(profile: GuardableProfile): boolean {
  return !hasEntries(profile.stackRequired) && !hasEntries(profile.roleTypes);
}

/**
 * Post-parse clamp: with no required stack the prompt's stack-mismatch cap
 * (gotcha 8/11) is vacuous, so the cap moves into code — fit ≤ 50 plus the
 * `no-profile-stack` flag. The flag survives priority-rule boosts, and the
 * alert path skips any job carrying it.
 */
export function capFitForMissingStack(
  c: ClaudeClassification,
  profile: Pick<GuardableProfile, 'stackRequired'>,
): ClaudeClassification {
  if (hasEntries(profile.stackRequired)) return c;
  return {
    ...c,
    fit_score: Math.min(c.fit_score, NO_STACK_FIT_CAP),
    red_flags: c.red_flags.includes(NO_PROFILE_STACK_FLAG)
      ? c.red_flags
      : [...c.red_flags, NO_PROFILE_STACK_FLAG],
  };
}
