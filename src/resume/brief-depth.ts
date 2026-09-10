import type { PostingBrief } from './prompts';

/*
 * How much this posting actually said — §17 of the Resume ↔ Job Intelligence
 * analysis, and the honesty rule that follows it in §15/16: advice drawn from
 * "what this kind of role usually asks for" must never be presented as
 * something the employer asked for.
 *
 * "Golang dev with AI experience" and a two-page requirements list produce
 * comparably confident-looking reports today, and the user has no way to tell
 * which one they are reading. The depth is computed from the stored brief —
 * no extra call, no model judgment — and the page says the quiet part out loud
 * when there is little to go on.
 *
 * Deliberately not used to re-weight the score (§18's adaptive weighting): the
 * weights want calibration data this product does not have yet, and a second
 * scoring lever is the last thing a number this volatile needs. Pure.
 */

const POSTING_DEPTHS = ['high', 'medium', 'low'] as const;
export type PostingDepth = (typeof POSTING_DEPTHS)[number];

export interface DepthReport {
  depth: PostingDepth;
  /** 0-6: how many kinds of information the posting carried. */
  signals: number;
  /** One sentence for the page — null when the posting says plenty. */
  notice: string | null;
}

/** How many named requirements a posting has to carry before it is "detailed". */
const MANY_REQUIREMENTS = 8;
const SOME_REQUIREMENTS = 4;

export function postingDepth(brief: PostingBrief | null | undefined): DepthReport {
  // No brief is "we have not read this posting yet", not "this posting is
  // thin" — a stale brief version or a failed call would otherwise put a
  // warning about the employer's posting on a page that simply lacks data.
  // The depth stays the conservative default; the user is told nothing.
  if (!brief) return { depth: 'low', signals: 0, notice: null };
  const wanted = brief.keywords.filter((k) => k.requirement === 'must' || k.requirement === 'preferred');
  const signals = [
    wanted.length >= MANY_REQUIREMENTS,
    wanted.length >= SOME_REQUIREMENTS,
    brief.role.seniority !== null || brief.role.years_min !== null,
    brief.company.industry !== null || brief.company.product !== null,
    brief.gates.length > 0,
    brief.screening.scan_for.length >= 3,
  ].filter(Boolean).length;
  const depth: PostingDepth = signals >= 5 ? 'high' : signals >= 3 ? 'medium' : 'low';
  return { depth, signals, notice: NOTICE[depth] };
}

const NOTICE: Record<PostingDepth, string | null> = {
  high: null,
  medium:
    'This posting names some of what it wants but not all of it. Where it is silent, the advice below follows what this kind of role usually asks for — treat those as worth having, not as things the employer demanded.',
  low: 'This posting says very little: only a handful of explicit requirements were found. Most of the advice below comes from what this kind of role usually asks for, not from the employer — read it as a direction, not a checklist.',
};
