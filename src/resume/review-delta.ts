import { REVIEW_DIMENSIONS, REVIEW_GRADES, type ReviewDimension, type ReviewGrade } from './review-score';

/*
 * What changed between two strength reviews of the SAME resume (ADR 0030
 * phase 3). The card can then answer the question a second run actually
 * raises — "did the edits work?" — instead of showing a fresh number with no
 * memory of the one before it.
 *
 * Deliberately narrow: two runs of the same rubric on the same resume, never
 * a trend across resumes or a chart. With prompt versions in the mix a
 * comparison can also be meaningless, and this says so rather than drawing a
 * line between two numbers that were never measured the same way.
 *
 * Pure.
 */

export interface ReviewSnapshot {
  score: number;
  version: number;
  promptVersion: number | null;
  grades: { dimension: ReviewDimension; grade: ReviewGrade }[];
}

export interface DimensionMove {
  dimension: ReviewDimension;
  from: ReviewGrade;
  to: ReviewGrade;
  /** True when the grade improved — the card colours the two directions apart. */
  up: boolean;
}

export interface ReviewDelta {
  scoreFrom: number;
  scoreTo: number;
  /** Positive when the resume got stronger. */
  points: number;
  /** Every dimension whose grade changed, strongest weight first. */
  moves: DimensionMove[];
  /** Same text, re-judged: the resume did not move, the model did. */
  sameVersion: boolean;
  /**
   * Set when the two runs used different prompt versions — the numbers come
   * from different rubrics, so the difference is not a measurement.
   */
  incomparable: boolean;
}

const RANK: Record<ReviewGrade, number> = { weak: 0, ok: 1, strong: 2 };

function gradeMap(snapshot: ReviewSnapshot): Map<ReviewDimension, ReviewGrade> {
  return new Map(snapshot.grades.map((g) => [g.dimension, g.grade]));
}

/**
 * `null` when there is nothing honest to compare: no earlier run, or one whose
 * grades did not survive (a pre-rubric row). The caller then shows the score
 * alone, exactly as it did before this existed.
 */
export function reviewDelta(previous: ReviewSnapshot | null, current: ReviewSnapshot): ReviewDelta | null {
  if (!previous || previous.grades.length === 0) return null;
  const before = gradeMap(previous);
  const after = gradeMap(current);
  const moves: DimensionMove[] = [];
  for (const dimension of REVIEW_DIMENSIONS) {
    const from = before.get(dimension);
    const to = after.get(dimension);
    if (!from || !to || from === to) continue;
    moves.push({ dimension, from, to, up: RANK[to] > RANK[from] });
  }
  return {
    scoreFrom: previous.score,
    scoreTo: current.score,
    points: current.score - previous.score,
    moves,
    sameVersion: previous.version === current.version,
    incomparable: previous.promptVersion !== current.promptVersion,
  };
}

/**
 * The one sentence above the grades. Says what moved and, when nothing did,
 * says that too — "no change" is a result, and a silent card looks broken.
 */
export function deltaSentence(delta: ReviewDelta): string {
  const { points, scoreFrom, scoreTo } = delta;
  const direction = points > 0 ? `up ${points}` : points < 0 ? `down ${Math.abs(points)}` : 'unchanged';
  const head =
    points === 0
      ? `Strength ${scoreTo}, ${direction} from the last review`
      : `Strength ${scoreFrom} → ${scoreTo}, ${direction}`;
  const moved =
    delta.moves.length === 0
      ? 'no dimension changed grade'
      : `${delta.moves.length} dimension${delta.moves.length === 1 ? '' : 's'} moved`;
  const caveat = delta.incomparable
    ? ' — but the two runs used different rubric versions, so the difference is not a measurement'
    : delta.sameVersion
      ? ' — same text, re-judged'
      : '';
  return `${head}; ${moved}${caveat}.`;
}

/** True for every grade string the delta can be built from. */
export function isReviewGrade(v: unknown): v is ReviewGrade {
  return typeof v === 'string' && (REVIEW_GRADES as readonly string[]).includes(v);
}
