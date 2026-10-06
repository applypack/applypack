import { t } from '../i18n/t';
import type { MatchHardRequirement } from '../resume/prompts';
import type { ScoreBreakdown } from '../resume/score';

/*
 * Where preparing an application stops, and why. Pure — each step's stored
 * result in, a stop or nothing out. The steps run cheapest first, so a stop
 * is also what was not paid for: a posting that closed costs no AI, and a
 * resume that cannot reach the floor is never researched on the web.
 *
 * A classifier fit says the posting suits the SEARCH; none of these is about
 * that. They ask the three things a person would before spending an evening:
 * is it still open, can this resume get there, is the company real.
 */

/** The steps of preparing one application, in the order they run. */
export const PREPARE_STEPS = ['liveness', 'brief', 'match', 'verify', 'tailor', 'rejudge', 'document', 'letter'] as const;
export type PrepareStep = (typeof PREPARE_STEPS)[number];

/** The lowest score editing must be able to reach for a pack to be worth preparing. */
export const DEFAULT_MIN_CEILING = 75;

export const PACK_STOPS = ['closed', 'failed-gate', 'low-ceiling', 'fake', 'skip'] as const;
export type PackStop = (typeof PACK_STOPS)[number];

export interface Stop {
  stop: PackStop;
  why: string;
}

/** The free check before any AI: only a posting known to be gone stops; "uncertain" goes on. */
export function livenessStop(result: { liveness: string; label: string }): Stop | null {
  return result.liveness === 'expired' ? { stop: 'closed', why: result.label } : null;
}

/**
 * After the comparison: a requirement the posting gates on and the resume
 * fails, or a ceiling under the floor — the score with every claimable
 * keyword written in (score.ts), so what no edit can change.
 */
export function compareStop(input: {
  breakdown: ScoreBreakdown;
  hard: MatchHardRequirement[];
  minCeiling: number;
}): Stop | null {
  const failed = input.hard.find((h) => h.status === 'fail');
  if (failed) {
    return { stop: 'failed-gate', why: failed.note ? `${failed.requirement} — ${failed.note}` : failed.requirement };
  }
  const { breakdown } = input;
  const ceiling = breakdown.ceiling ?? breakdown.score;
  if (ceiling >= input.minCeiling) return null;
  const why =
    breakdown.primaryPresent < breakdown.primaryTotal
      ? t('pack.why.lowCeilingCore', { ceiling, floor: input.minCeiling, present: breakdown.primaryPresent, total: breakdown.primaryTotal })
      : t('pack.why.lowCeiling', { ceiling, floor: input.minCeiling });
  return { stop: 'low-ceiling', why };
}

/** After the web check: a fake, or a posting the check says to skip (dead, re-posted for months). */
export function verifyStop(v: { verdict: string; recommendation: string; summary: string }): Stop | null {
  if (v.verdict === 'fake') return { stop: 'fake', why: v.summary };
  if (v.recommendation === 'skip') return { stop: 'skip', why: v.summary };
  return null;
}
