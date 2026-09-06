import { z } from 'zod';

/*
 * Deterministic match score (ADR 0012). The model judges FACTS — per-keyword
 * status, alignment grades, red flags — and this module turns them into the
 * number. Same weights, same result, every run; unit-testable without AI.
 *
 * MIRROR: src/web/public/score.mjs implements the same formula for the live
 * editor (credit from textual presence instead of AI status). Any change here
 * must land there too — the parity test in src/web/score.test.ts fails otherwise.
 */

export const KEYWORD_STATUSES = ['present', 'add', 'ask_user', 'cannot_claim'] as const;
export type KeywordStatus = (typeof KEYWORD_STATUSES)[number];

export const REQUIREMENT_LEVELS = ['must', 'preferred', 'nice', 'context'] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

export const ALIGNMENT_GRADES = ['strong', 'partial', 'off'] as const;
export type AlignmentGrade = (typeof ALIGNMENT_GRADES)[number];

export interface MatchAlignment {
  title: AlignmentGrade;
  summary: AlignmentGrade;
  recent_role: AlignmentGrade;
}

export const SCORING = {
  /** v4: either/or requirement groups count once (ADR 0044). */
  version: 4,
  /** Keyword coverage: up to 60 points, weighted by how hard the posting wants each term. */
  keywordMax: 60,
  requirementWeight: { must: 3, preferred: 2, nice: 1, context: 0 } as Record<RequirementLevel, number>,
  /** Credit per AI status: evidenced-but-unwritten counts half, unverified counts zero. */
  statusCredit: { present: 1, add: 0.5, ask_user: 0, cannot_claim: 0 } as Record<KeywordStatus, number>,
  /** Alignment: title 10 + summary 10 + most recent role 20. */
  titleMax: 10,
  summaryMax: 10,
  recentRoleMax: 20,
  alignmentCredit: { strong: 1, partial: 0.5, off: 0 } as Record<AlignmentGrade, number>,
  /**
   * Each red flag subtracts 10, BUT (v3): flags duplicating missing primary
   * items are not counted (the cap already punishes the stack), and the total
   * penalty is bounded — soft nitpicks must never build an unbeatable ceiling
   * (a real 97.9-point resume was stuck at 68 by three style "flags").
   */
  redFlagPenalty: 10,
  penaltyMax: 20,
  /** Primary-stack gate (CLAUDE.md gotcha 11): share of primary items present caps the total. */
  caps: { none: 30, underHalf: 45, halfOrMore: 70 },
} as const;

/**
 * One keyword reduced to what the formula needs. `credit` is 0..1 for the
 * current text; `ceilCredit` is what the same keyword could earn after honest
 * editing (write in every present/add term; ask/cannot stay 0). `primaryHit`
 * feeds the cap now, `ceilPrimaryHit` feeds the reachable cap.
 */
export interface ScoreEntry {
  requirement: RequirementLevel;
  primary: boolean;
  credit: number;
  primaryHit: boolean;
  ceilCredit: number;
  ceilPrimaryHit: boolean;
  /**
   * Requirement-group label (ADR 0044). Entries sharing one are alternatives
   * the posting itself offered — "frameworks like React, Next.js, or Vue.js" —
   * and `foldGroups` counts them ONCE. Absent means the term stands alone,
   * which is every entry on a row written before v8.
   */
  group?: string | null;
}

export interface ScoreBreakdown {
  v: number;
  /** 0..keywordMax, one decimal. */
  keywordPts: number;
  keywordMax: number;
  /** Weighted units earned / total, for the "44 of 60" style line. */
  keywordEarned: number;
  keywordTotal: number;
  alignmentPts: number;
  alignmentMax: number;
  penalty: number;
  /** Red flags the penalty actually counted (excess over missing primaries, bounded). */
  flagsCounted?: number;
  primaryTotal: number;
  primaryPresent: number;
  /** The cap that applied, or null when the primary stack is fully present (or absent). */
  cap: number | null;
  score: number;
  /**
   * The honest maximum for THIS resume on THIS posting: every claimable
   * keyword written in, alignment perfect, unfixable flags kept. What editing
   * can reach — anything above it needs experience the resume doesn't have.
   */
  ceiling?: number;
  /** The grades behind alignmentPts, kept for the breakdown UI. */
  alignment: MatchAlignment | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function primaryCap(present: number, total: number): number | null {
  if (total === 0 || present >= total) return null;
  if (present === 0) return SCORING.caps.none;
  if (present * 2 >= total) return SCORING.caps.halfOrMore;
  return SCORING.caps.underHalf;
}

/**
 * Either/or requirements, folded to one entry each (ADR 0044).
 *
 * A posting that says "React, Next.js, or Vue.js" asks ONE question, and
 * before this the model answered it three times: a candidate who had React
 * and lacked the other two lost two must-weights for a requirement they meet.
 * The same arithmetic made "PHP, Python, or Node.js" and "WordPress, Drupal,
 * Shopify" cost 12 of 66 weighted units on a resume that satisfied the first
 * of them outright.
 *
 * The fold takes the best member on every axis: the strongest requirement
 * level among them (they should agree — the brief puts the group's level on
 * each — and the strongest is the safe reconciliation when they do not), the
 * best credit, and primary if any member is primary. Order is preserved so a
 * breakdown still reads in the posting's order.
 */
export function foldGroups(entries: ScoreEntry[]): ScoreEntry[] {
  const out: ScoreEntry[] = [];
  const at = new Map<string, number>();
  for (const e of entries) {
    const key = e.group?.trim().toLowerCase();
    if (!key) {
      out.push(e);
      continue;
    }
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, out.length);
      out.push(e);
      continue;
    }
    const held = out[seen]!;
    out[seen] = {
      ...held,
      requirement: strongerLevel(held.requirement, e.requirement),
      credit: Math.max(held.credit, e.credit),
      ceilCredit: Math.max(held.ceilCredit, e.ceilCredit),
      primary: held.primary || e.primary,
      primaryHit: held.primaryHit || e.primaryHit,
      ceilPrimaryHit: held.ceilPrimaryHit || e.ceilPrimaryHit,
    };
  }
  return out;
}

function strongerLevel(a: RequirementLevel, b: RequirementLevel): RequirementLevel {
  return SCORING.requirementWeight[a] >= SCORING.requirementWeight[b] ? a : b;
}

/**
 * The formula. Shared shape with score.mjs: callers precompute `credit` and
 * `primaryHit` (server: from AI status via entriesFromKeywords; browser: from
 * live textual presence), the composition below is identical on both sides.
 */
export function computeScore(
  rawEntries: ScoreEntry[],
  alignment: MatchAlignment | null,
  redFlagCount: number,
  /** Live estimates pass the analysis-time penalty — see the comment below. */
  fixedPenalty: number | null = null,
): ScoreBreakdown {
  const entries = foldGroups(rawEntries);
  let earned = 0;
  let ceilEarned = 0;
  let total = 0;
  let primaryTotal = 0;
  let primaryPresent = 0;
  let ceilPrimaryPresent = 0;
  for (const e of entries) {
    const weight = SCORING.requirementWeight[e.requirement] ?? 0;
    total += weight;
    earned += weight * Math.max(0, Math.min(1, e.credit));
    ceilEarned += weight * Math.max(0, Math.min(1, e.ceilCredit));
    if (e.primary) {
      primaryTotal++;
      if (e.primaryHit) primaryPresent++;
      if (e.ceilPrimaryHit) ceilPrimaryPresent++;
    }
  }
  const alignmentMax = SCORING.titleMax + SCORING.summaryMax + SCORING.recentRoleMax;
  const keywordPts = total === 0 ? 0 : round1((SCORING.keywordMax * earned) / total);
  const a = alignment;
  const alignmentPts = a
    ? round1(
        SCORING.titleMax * SCORING.alignmentCredit[a.title] +
          SCORING.summaryMax * SCORING.alignmentCredit[a.summary] +
          SCORING.recentRoleMax * SCORING.alignmentCredit[a.recent_role],
      )
    : 0;
  // Flags that merely restate a missing primary item are already punished by
  // the cap; count only the excess, and bound the total (v3). Live estimates
  // pass the analysis-time penalty instead: the flag texts were judged against
  // the analysed snapshot, so typing a missing primary into the editor must
  // not re-inflate them (42 → 29 on the cover-letter fixture was this bug).
  const missingPrimary = primaryTotal - primaryPresent;
  const flagsCounted = Math.max(0, redFlagCount - missingPrimary);
  const penalty =
    fixedPenalty ?? Math.min(flagsCounted * SCORING.redFlagPenalty, SCORING.penaltyMax);
  const cap = primaryCap(primaryPresent, primaryTotal);
  const raw = Math.round(Math.max(0, keywordPts + alignmentPts - penalty));
  const score = Math.max(0, Math.min(100, cap === null ? raw : Math.min(raw, cap)));

  // The reachable maximum: claimable keywords written in, alignment perfect,
  // the same non-primary flags still standing, cap from claimable primaries.
  const ceilKeywordPts = total === 0 ? 0 : round1((SCORING.keywordMax * ceilEarned) / total);
  const ceilCap = primaryCap(ceilPrimaryPresent, primaryTotal);
  const ceilRaw = Math.round(Math.max(0, ceilKeywordPts + alignmentMax - penalty));
  const ceiling = Math.max(
    score,
    Math.min(100, ceilCap === null ? ceilRaw : Math.min(ceilRaw, ceilCap)),
  );

  return {
    v: SCORING.version,
    keywordPts,
    keywordMax: SCORING.keywordMax,
    keywordEarned: round1(earned),
    keywordTotal: total,
    alignmentPts,
    alignmentMax,
    penalty,
    flagsCounted,
    primaryTotal,
    primaryPresent,
    cap,
    score,
    ceiling,
    alignment: a,
  };
}

/**
 * Server-side entries: credit from the AI's status judgment on the analysed
 * text. A "primary" mark only counts when the keyword is a must requirement —
 * a preferred technology must never cap the score (v3).
 */
export function entriesFromKeywords(
  keywords: { requirement: RequirementLevel; primary: boolean; status: KeywordStatus; group?: string | null }[],
): ScoreEntry[] {
  return keywords.map((k) => {
    const primary = k.primary && k.requirement === 'must';
    const claimable = k.status === 'present' || k.status === 'add';
    return {
      requirement: k.requirement,
      primary,
      credit: SCORING.statusCredit[k.status] ?? 0,
      primaryHit: k.status === 'present',
      ceilCredit: claimable ? 1 : 0,
      ceilPrimaryHit: primary && claimable,
      group: k.group ?? null,
    };
  });
}

export function scoreMatch(
  keywords: { requirement: RequirementLevel; primary: boolean; status: KeywordStatus; group?: string | null }[],
  alignment: MatchAlignment | null,
  redFlagCount: number,
): ScoreBreakdown {
  return computeScore(entriesFromKeywords(keywords), alignment, redFlagCount);
}

/* Reader for the stored Json column — {} on rows written before ADR 0012. */

const BreakdownSchema = z.object({
  v: z.number().int(),
  keywordPts: z.number(),
  keywordMax: z.number(),
  keywordEarned: z.number(),
  keywordTotal: z.number(),
  alignmentPts: z.number(),
  alignmentMax: z.number(),
  penalty: z.number(),
  // v3 additions — absent on v2 rows.
  flagsCounted: z.number().int().optional(),
  primaryTotal: z.number().int(),
  primaryPresent: z.number().int(),
  cap: z.number().nullable(),
  score: z.number(),
  ceiling: z.number().optional(),
  alignment: z
    .object({
      title: z.enum(ALIGNMENT_GRADES),
      summary: z.enum(ALIGNMENT_GRADES),
      recent_role: z.enum(ALIGNMENT_GRADES),
    })
    .nullish()
    .transform((v) => v ?? null),
});

export function readBreakdown(v: unknown): ScoreBreakdown | null {
  const r = BreakdownSchema.safeParse(v);
  return r.success ? r.data : null;
}
