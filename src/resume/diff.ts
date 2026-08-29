import type { MatchKeyword } from './prompts';
import type { ScoreBreakdown } from './score';

/*
 * Version delta, computed — not narrated. Compares two stored matches of the
 * same job and answers "why did v5 beat v4" from keyword-status transitions
 * and score-component differences. Pure: tested in diff.test.ts.
 */

export interface MatchDelta {
  /** Terms that became "present" (compared by term, case-insensitive). */
  gained: string[];
  /** Terms that were "present" before and no longer are. */
  lost: string[];
  /** next − prev per score component; null when either side predates ADR 0012. */
  components: {
    keywordPts: number;
    alignmentPts: number;
    penalty: number;
    score: number;
    capBefore: number | null;
    capAfter: number | null;
  } | null;
}

export function diffMatches(
  prev: { keywords: MatchKeyword[]; breakdown: ScoreBreakdown | null },
  next: { keywords: MatchKeyword[]; breakdown: ScoreBreakdown | null },
): MatchDelta {
  const prevStatus = new Map(prev.keywords.map((k) => [k.term.toLowerCase(), k.status]));
  const nextStatus = new Map(next.keywords.map((k) => [k.term.toLowerCase(), k.status]));

  const gained: string[] = [];
  for (const k of next.keywords) {
    const before = prevStatus.get(k.term.toLowerCase());
    if (k.status === 'present' && before !== undefined && before !== 'present') gained.push(k.term);
  }
  const lost: string[] = [];
  for (const k of prev.keywords) {
    const after = nextStatus.get(k.term.toLowerCase());
    if (k.status === 'present' && after !== undefined && after !== 'present') lost.push(k.term);
  }

  const p = prev.breakdown;
  const n = next.breakdown;
  const round1 = (x: number): number => Math.round(x * 10) / 10;
  const components =
    p && n
      ? {
          keywordPts: round1(n.keywordPts - p.keywordPts),
          alignmentPts: round1(n.alignmentPts - p.alignmentPts),
          penalty: n.penalty - p.penalty,
          score: n.score - p.score,
          capBefore: p.cap,
          capAfter: n.cap,
        }
      : null;

  return { gained, lost, components };
}
