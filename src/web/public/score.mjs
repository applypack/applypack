/*
 * Deterministic match score — browser copy of src/resume/score.ts (ADR 0012).
 * The server scores from the AI's per-keyword statuses; the live editor scores
 * from what the text actually contains right now. Same weights, same formula.
 *
 * MIRROR: any change to the tables or composition must land in score.ts too —
 * src/web/score.test.ts asserts both implementations agree.
 */

export const SCORING = {
  version: 3,
  keywordMax: 60,
  requirementWeight: { must: 3, preferred: 2, nice: 1, context: 0 },
  statusCredit: { present: 1, add: 0.5, ask_user: 0, cannot_claim: 0 },
  titleMax: 10,
  summaryMax: 10,
  recentRoleMax: 20,
  alignmentCredit: { strong: 1, partial: 0.5, off: 0 },
  redFlagPenalty: 10,
  penaltyMax: 20,
  caps: { none: 30, underHalf: 45, halfOrMore: 70 },
};

const round1 = (n) => Math.round(n * 10) / 10;

export function primaryCap(present, total) {
  if (total === 0 || present >= total) return null;
  if (present === 0) return SCORING.caps.none;
  if (present * 2 >= total) return SCORING.caps.halfOrMore;
  return SCORING.caps.underHalf;
}

/**
 * entries: [{ requirement, primary, credit, primaryHit, ceilCredit,
 * ceilPrimaryHit }] — see score.ts. Flags duplicating missing primaries are
 * not counted and the penalty is bounded (v3); `ceiling` is the honest
 * maximum this resume can reach on this posting by editing alone.
 */
export function computeScore(entries, alignment, redFlagCount) {
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
  const missingPrimary = primaryTotal - primaryPresent;
  const flagsCounted = Math.max(0, redFlagCount - missingPrimary);
  const penalty = Math.min(flagsCounted * SCORING.redFlagPenalty, SCORING.penaltyMax);
  const cap = primaryCap(primaryPresent, primaryTotal);
  const raw = Math.round(Math.max(0, keywordPts + alignmentPts - penalty));
  const score = Math.max(0, Math.min(100, cap === null ? raw : Math.min(raw, cap)));

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
    alignment: a ?? null,
  };
}

/**
 * Live entries from scoreKeywords() rows ({ requirement, primary, status, found }).
 * Textual presence earns full credit — except cannot_claim, which never counts
 * even when the user types the word (claim safety). An "add" keyword keeps its
 * half credit until the user actually writes it in. A "primary" mark only
 * counts on must requirements, mirroring entriesFromKeywords.
 */
export function entriesFromLive(rows) {
  return rows.map((r) => {
    const primary = r.primary === true && r.requirement === 'must';
    const claimable = r.status !== 'cannot_claim';
    const writable = r.status === 'present' || r.status === 'add';
    return {
      requirement: r.requirement ?? 'preferred',
      primary,
      credit: !claimable ? 0 : r.found ? 1 : r.status === 'add' ? 0.5 : 0,
      primaryHit: primary && claimable && r.found === true,
      ceilCredit: writable ? 1 : 0,
      ceilPrimaryHit: primary && writable,
    };
  });
}
