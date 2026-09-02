import { z } from 'zod';

/*
 * Deterministic strength score for one resume, job-agnostic (docs/resumes-plan.md
 * §B.3). The same division of labour as the match score (ADR 0012): the model
 * grades each dimension and quotes its evidence, THIS module turns the grades
 * into the number — because every scoring prompt in this repo inflates when it
 * is allowed to do arithmetic (CLAUDE.md gotchas 8 and 11).
 *
 * Two hard caps carry the judgment that weights alone cannot:
 *
 * - A resume that lists duties without outcomes cannot read as a top hire,
 *   however polished the rest is. `impact` weak caps the total at 55.
 * - Two or more weak dimensions cap it at 45 — a resume with two broken legs
 *   is not "above average" because the other four are fine.
 *
 * Pure — tested in review-score.test.ts, including the duties-only guard.
 */

export const REVIEW_DIMENSIONS = [
  'first_impression',
  'impact',
  'seniority_signal',
  'clarity',
  'keyword_coverage',
  'polish',
] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

export const REVIEW_GRADES = ['strong', 'ok', 'weak'] as const;
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

export const REVIEW_SCORING = {
  version: 1,
  /**
   * Out of 100. Impact leads because it is what separates a senior resume from
   * a job description of the same role; polish trails because clean wording
   * never rescues a resume with nothing to say.
   */
  weight: {
    first_impression: 20,
    impact: 30,
    seniority_signal: 20,
    clarity: 15,
    keyword_coverage: 10,
    polish: 5,
  } as Record<ReviewDimension, number>,
  /** "ok" is half credit: acceptable and unremarkable. "weak" earns nothing. */
  credit: { strong: 1, ok: 0.5, weak: 0 } as Record<ReviewGrade, number>,
  caps: { impactWeak: 55, twoWeak: 45 },
} as const;

export const REVIEW_WEIGHT_TOTAL = REVIEW_DIMENSIONS.reduce((n, d) => n + REVIEW_SCORING.weight[d], 0);

/** One graded dimension, as the formula reads it. */
export interface ReviewGradeEntry {
  dimension: ReviewDimension;
  grade: ReviewGrade;
}

export interface ReviewBreakdown {
  v: number;
  /** Raw weighted points before the caps, one decimal. */
  rawPts: number;
  max: number;
  /** Per-dimension points, for the "impact 15/30" line under each row. */
  points: Record<string, number>;
  weakCount: number;
  /** The cap that applied, or null when none did. */
  cap: number | null;
  /** Which rule capped it — the card says why, never just what. */
  capReason: 'impact' | 'two-weak' | null;
  score: number;
  /** Dimensions the model did not grade; they earn nothing and are named on the card. */
  missing: string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Grades → 0-100. A dimension the reply omitted earns zero rather than being
 * dropped from the denominator: a missing judgment is not a good one.
 */
export function scoreReview(grades: ReviewGradeEntry[]): ReviewBreakdown {
  const byDimension = new Map<ReviewDimension, ReviewGrade>();
  for (const g of grades) if (!byDimension.has(g.dimension)) byDimension.set(g.dimension, g.grade);

  const points: Record<string, number> = {};
  let rawPts = 0;
  let weakCount = 0;
  const missing: string[] = [];
  for (const dimension of REVIEW_DIMENSIONS) {
    const grade = byDimension.get(dimension);
    if (grade === undefined) {
      missing.push(dimension);
      points[dimension] = 0;
      continue;
    }
    if (grade === 'weak') weakCount++;
    const pts = round1(REVIEW_SCORING.weight[dimension] * REVIEW_SCORING.credit[grade]);
    points[dimension] = pts;
    rawPts += pts;
  }

  // A missing grade is weak in everything but name — it must not dodge the caps.
  const effectiveWeak = weakCount + missing.length;
  const impactWeak = byDimension.get('impact') !== 'strong' && byDimension.get('impact') !== 'ok';
  const cap = impactWeak
    ? Math.min(REVIEW_SCORING.caps.impactWeak, effectiveWeak >= 2 ? REVIEW_SCORING.caps.twoWeak : 100)
    : effectiveWeak >= 2
      ? REVIEW_SCORING.caps.twoWeak
      : null;
  const capReason = cap === null ? null : cap === REVIEW_SCORING.caps.twoWeak ? 'two-weak' : 'impact';
  const raw = Math.round(round1(rawPts));

  return {
    v: REVIEW_SCORING.version,
    rawPts: round1(rawPts),
    max: REVIEW_WEIGHT_TOTAL,
    points,
    weakCount: effectiveWeak,
    cap,
    capReason,
    score: Math.max(0, Math.min(100, cap === null ? raw : Math.min(raw, cap))),
    missing,
  };
}

/** Plain-words reason for the cap — the card must never show a number it cannot explain. */
export function capExplanation(bd: ReviewBreakdown): string | null {
  if (bd.capReason === null) return null;
  return bd.capReason === 'impact'
    ? `Capped at ${bd.cap}: the experience reads as duties rather than outcomes, and no amount of polish elsewhere makes a resume read senior without them.`
    : `Capped at ${bd.cap}: ${bd.weakCount} of ${REVIEW_DIMENSIONS.length} dimensions came back weak — those are the ones to fix first.`;
}

/* Stored JSON: the computation plus the prompt that produced the grades. The
   version rides inside the breakdown, as ResumeMatch has done since ADR 0029 —
   a marker never needs a column of its own. */

export function storedReviewBreakdown(
  bd: ReviewBreakdown,
  meta: { promptVersion: number },
): Record<string, unknown> {
  return { ...bd, promptVersion: meta.promptVersion };
}

const ReviewBreakdownSchema = z.object({
  v: z.number().int(),
  rawPts: z.number(),
  max: z.number(),
  points: z.record(z.string(), z.number()).default({}),
  weakCount: z.number().int(),
  cap: z.number().nullable(),
  capReason: z.enum(['impact', 'two-weak']).nullish().transform((x) => x ?? null),
  score: z.number(),
  missing: z.array(z.string()).default([]),
});

export function readReviewBreakdown(v: unknown): ReviewBreakdown | null {
  const r = ReviewBreakdownSchema.safeParse(v);
  return r.success ? r.data : null;
}

/**
 * The rubric version a stored review was graded under. Two runs from
 * different versions are two different measurements, which is what the delta
 * has to say out loud instead of subtracting them (review-delta.ts).
 */
export function readReviewPromptVersion(breakdown: unknown): number | null {
  if (typeof breakdown !== 'object' || breakdown === null) return null;
  const v = (breakdown as { promptVersion?: unknown }).promptVersion;
  return Number.isInteger(v) ? (v as number) : null;
}

/**
 * A review describes the version it read. Once the resume moves on, its
 * verdict is about text that no longer exists — the card says so rather than
 * quietly ageing.
 */
export function reviewIsStale(reviewVersion: number, resumeVersion: number): boolean {
  return reviewVersion < resumeVersion;
}
