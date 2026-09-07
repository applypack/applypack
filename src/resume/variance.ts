import { composeScore, type MatchAlignment, type ScoreBreakdown } from './score';
import type { MatchKeyword } from './prompts';

/*
 * What a repeated comparison of ONE pair actually varies by, and which part of
 * the formula the variation comes from.
 *
 * The rubric's cliffs are fixed (ADR 0044 and its addendum), so what is left is
 * the model's judgment: the three alignment grades, the red flags it chooses to
 * write, and the per-keyword statuses. Those feed three different pools, and
 * "the score moved 20 points" is not an answer anyone can act on. This turns a
 * set of stored breakdowns into the question worth asking — hold one part
 * still, and how much of the spread survives?
 *
 * Pure: the runs arrive as arguments, the harness does the calling.
 */

export interface VarianceRun {
  score: number;
  breakdown: ScoreBreakdown;
  keywords: Pick<MatchKeyword, 'term' | 'status'>[];
  redFlags: number;
  actions: number;
}

export interface Spread {
  min: number;
  max: number;
  mean: number;
  /** Population standard deviation — there is no sampling here, these are the runs. */
  sd: number;
  spread: number;
}

export function spreadOf(values: number[]): Spread {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, sd: 0, spread: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: round1(mean),
    sd: round1(Math.sqrt(variance)),
    spread: round1(Math.max(...values) - Math.min(...values)),
  };
}

/** The value that occurs most often; ties go to the first seen, which is run order. */
export function modeOf<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

export type Part = 'keywords' | 'alignment' | 'penalty' | 'cap';

export interface Attribution {
  part: Part;
  /** The score spread that survives when this part is held at its modal value. */
  spreadWithout: number;
  /** How much of the original spread this part accounts for, 0..1. */
  share: number;
}

/**
 * How much of the score spread each part of the formula is responsible for:
 * recompose every run with that one part frozen at its modal value and measure
 * what is left. Shares do not sum to 1 — the parts interact through the cap,
 * and that is the honest picture rather than a tidy one.
 */
export function attribute(runs: VarianceRun[]): { total: number; parts: Attribution[] } {
  const scores = runs.map((r) => r.score);
  const total = spreadOf(scores).spread;
  const fixed = {
    keywords: modeOf(runs.map((r) => r.breakdown.keywordPts)) ?? 0,
    alignment: modeOf(runs.map((r) => r.breakdown.alignmentPts)) ?? 0,
    penalty: modeOf(runs.map((r) => r.breakdown.penalty)) ?? 0,
    cap: modeOf(runs.map((r) => r.breakdown.cap)) ?? null,
  };
  const parts = (['keywords', 'alignment', 'penalty', 'cap'] as Part[]).map((part) => {
    const recomposed = runs.map((r) =>
      composeScore(
        part === 'keywords' ? fixed.keywords : r.breakdown.keywordPts,
        part === 'alignment' ? fixed.alignment : r.breakdown.alignmentPts,
        part === 'penalty' ? fixed.penalty : r.breakdown.penalty,
        part === 'cap' ? fixed.cap : r.breakdown.cap,
      ),
    );
    const left = spreadOf(recomposed).spread;
    return { part, spreadWithout: left, share: total === 0 ? 0 : round1((total - left) / total) };
  });
  return { total, parts: parts.sort((a, b) => b.share - a.share) };
}

export interface GradeDrift {
  dimension: keyof MatchAlignment;
  mode: string;
  /** Runs that graded it something other than the modal grade. */
  differed: number;
  grades: string[];
}

export function alignmentDrift(runs: VarianceRun[]): GradeDrift[] {
  const dims: (keyof MatchAlignment)[] = ['title', 'summary', 'recent_role'];
  return dims.map((dimension) => {
    const grades = runs.map((r) => r.breakdown.alignment?.[dimension] ?? '-');
    const mode = modeOf(grades) ?? '-';
    return { dimension, mode, differed: grades.filter((g) => g !== mode).length, grades };
  });
}

export interface StatusDrift {
  term: string;
  /** Every status this term was given across the runs, in run order. */
  statuses: string[];
  stable: boolean;
}

/** Which keywords the model could not make its mind up about. Terms missing from a run read as "-". */
export function statusDrift(runs: VarianceRun[]): StatusDrift[] {
  const terms = [...new Set(runs.flatMap((r) => r.keywords.map((k) => k.term)))];
  return terms
    .map((term) => {
      const statuses = runs.map((r) => r.keywords.find((k) => k.term === term)?.status ?? '-');
      return { term, statuses, stable: new Set(statuses).size === 1 };
    })
    .sort((a, b) => Number(a.stable) - Number(b.stable));
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
