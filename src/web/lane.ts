/*
 * Which lane the resume calls run on — engine × model family — and what
 * each step costs there, measured 2026-09-05 on the reference pair, a
 * 6 000-character resume against a 7 700-character posting
 * (docs/target-plan.md §2.3). The run page states the band for the lane
 * this install is on instead of one "half a minute to a minute" for all.
 * Pure — tested in lane.test.ts.
 */

import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

export type Lane = 'cli-haiku' | 'cli-sonnet' | 'cli-opus' | 'api-haiku' | 'api-sonnet' | 'api-opus' | 'other';
type MeasuredLane = Exclude<Lane, 'other'>;
type TimedStep = 'scan' | 'structure' | 'keywords' | 'match' | 'suggestions' | 'review';

/** The route a model is reached by, as a catalog message, and the model's name — the same in every language. */
const LABEL = {
  'cli-haiku': ['lane.cli', 'Haiku 4.5'],
  'cli-sonnet': ['lane.cli', 'Sonnet 5'],
  'cli-opus': ['lane.cli', 'Opus 5'],
  'api-haiku': ['lane.api', 'Haiku 4.5'],
  'api-sonnet': ['lane.api', 'Sonnet 5'],
  'api-opus': ['lane.api', 'Opus 5'],
} as const satisfies Record<MeasuredLane, readonly [route: MessageKey, model: string]>;

/** How long a call takes, as a catalog message and the seconds it names. */
type Band = readonly [key: MessageKey, seconds?: number];
const exactly = (seconds: number): Band => ['lane.band.seconds', seconds];
const roughly = (seconds: number): Band => ['lane.band.aboutSeconds', seconds];
const ABOUT_A_MINUTE: Band = ['lane.band.aboutMinute'];

/**
 * Wall seconds per call. The CLI caps thinking (v1.59.1), so Sonnet and
 * Opus are quick there; on the API Sonnet 5 and Opus 5 think for a minute
 * and the API's suggestions / review were not measured. "~" is an estimate:
 * the CLI ratio applied to the API's quick check, and — for scan and
 * structure — the measured scan of v1.65 (35–75 s) split between the two
 * calls it became in v1.66.
 */
const BANDS: Record<MeasuredLane, Record<TimedStep, Band>> = {
  'cli-sonnet': { scan: roughly(20), structure: roughly(40), keywords: exactly(20), match: exactly(35), suggestions: exactly(30), review: exactly(40) },
  'cli-haiku': { scan: roughly(25), structure: roughly(45), keywords: ['lane.band.secondsOrTwice', 25], match: exactly(75), suggestions: exactly(35), review: exactly(55) },
  'cli-opus': { scan: roughly(25), structure: roughly(50), keywords: exactly(25), match: exactly(60), suggestions: exactly(45), review: exactly(50) },
  'api-haiku': { scan: roughly(15), structure: roughly(30), keywords: exactly(20), match: exactly(45), suggestions: roughly(30), review: roughly(40) },
  'api-sonnet': { scan: roughly(40), structure: ABOUT_A_MINUTE, keywords: exactly(65), match: ['lane.band.overTwoMinutes'], suggestions: ABOUT_A_MINUTE, review: ABOUT_A_MINUTE },
  'api-opus': { scan: roughly(35), structure: ABOUT_A_MINUTE, keywords: exactly(40), match: exactly(110), suggestions: ABOUT_A_MINUTE, review: ABOUT_A_MINUTE },
};

export function laneOf(provider: string, model: string): Lane {
  const family = /haiku/i.test(model) ? 'haiku' : /sonnet/i.test(model) ? 'sonnet' : /opus/i.test(model) ? 'opus' : null;
  if (!family) return 'other';
  if (provider === 'claude_code') return `cli-${family}`;
  if (provider === 'anthropic_api') return `api-${family}`;
  return 'other';
}

export function laneLabel(lane: Lane): string {
  if (lane === 'other') return t('lane.other');
  const [route, model] = LABEL[lane];
  return t(route, { model });
}

/** The measured band for a step on a lane, or null when either is not one we measured. */
export function bandFor(step: string, lane: Lane): string | null {
  if (lane === 'other') return null;
  const bands: Record<string, Band> = BANDS[lane];
  const band = bands[step];
  if (!band) return null;
  const [key, seconds] = band;
  return t(key, seconds === undefined ? {} : { n: seconds });
}
