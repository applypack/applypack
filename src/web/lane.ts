/*
 * Which lane the resume calls run on — engine × model family — and what
 * each step costs there, measured 2026-09-05 on the reference pair, a
 * 6 000-character resume against a 7 700-character posting
 * (docs/target-plan.md §2.3). The run page states the band for the lane
 * this install is on instead of one "half a minute to a minute" for all.
 * Pure — tested in lane.test.ts.
 */

export type Lane = 'cli-haiku' | 'cli-sonnet' | 'cli-opus' | 'api-haiku' | 'api-sonnet' | 'api-opus' | 'other';
type MeasuredLane = Exclude<Lane, 'other'>;
type TimedStep = 'scan' | 'structure' | 'keywords' | 'match' | 'suggestions' | 'review';

const LABEL: Record<MeasuredLane, string> = {
  'cli-haiku': 'Haiku 4.5 through the Claude CLI',
  'cli-sonnet': 'Sonnet 5 through the Claude CLI',
  'cli-opus': 'Opus 5 through the Claude CLI',
  'api-haiku': 'Haiku 4.5 on the API',
  'api-sonnet': 'Sonnet 5 on the API',
  'api-opus': 'Opus 5 on the API',
};

/**
 * Wall seconds per call. The CLI caps thinking (v1.59.1), so Sonnet and
 * Opus are quick there; on the API Sonnet 5 and Opus 5 think for a minute
 * and the API's suggestions / review were not measured. "~" is an estimate:
 * the CLI ratio applied to the API's quick check, and — for scan and
 * structure — the measured scan of v1.65 (35–75 s) split between the two
 * calls it became in v1.66.
 */
const BANDS: Record<MeasuredLane, Record<TimedStep, string>> = {
  'cli-sonnet': { scan: '~20 s', structure: '~40 s', keywords: '20 s', match: '35 s', suggestions: '30 s', review: '40 s' },
  'cli-haiku': { scan: '~25 s', structure: '~45 s', keywords: '25 s, twice that when a reply has to be retried', match: '75 s', suggestions: '35 s', review: '55 s' },
  'cli-opus': { scan: '~25 s', structure: '~50 s', keywords: '25 s', match: '60 s', suggestions: '45 s', review: '50 s' },
  'api-haiku': { scan: '~15 s', structure: '~30 s', keywords: '20 s', match: '45 s', suggestions: '~30 s', review: '~40 s' },
  'api-sonnet': { scan: '~40 s', structure: '~1 minute', keywords: '65 s', match: 'more than 2 minutes', suggestions: '~1 minute', review: '~1 minute' },
  'api-opus': { scan: '~35 s', structure: '~1 minute', keywords: '40 s', match: '110 s', suggestions: '~1 minute', review: '~1 minute' },
};

export function laneOf(provider: string, model: string): Lane {
  const family = /haiku/i.test(model) ? 'haiku' : /sonnet/i.test(model) ? 'sonnet' : /opus/i.test(model) ? 'opus' : null;
  if (!family) return 'other';
  if (provider === 'claude_code') return `cli-${family}`;
  if (provider === 'anthropic_api') return `api-${family}`;
  return 'other';
}

export function laneLabel(lane: Lane): string {
  return lane === 'other' ? 'this engine' : LABEL[lane];
}

/** The measured band for a step on a lane, or null when either is not one we measured. */
export function bandFor(step: string, lane: Lane): string | null {
  if (lane === 'other') return null;
  const bands: Record<string, string> = BANDS[lane];
  return bands[step] ?? null;
}
