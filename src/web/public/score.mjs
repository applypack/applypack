/*
 * Deterministic match score — browser copy of src/resume/score.ts (ADR 0012).
 * The server scores from the AI's per-keyword statuses; the live editor scores
 * from what the text actually contains right now. Same weights, same formula.
 *
 * MIRROR: any change to the tables or composition must land in score.ts too —
 * src/web/score.test.ts asserts both implementations agree.
 */

export const SCORING = {
  version: 4,
  keywordMax: 60,
  requirementWeight: { must: 3, preferred: 2, nice: 1, context: 0 },
  statusCredit: { present: 1, add: 0.5, ask_user: 0, cannot_claim: 0 },
  // "Has it" for the primary cap — see score.ts. `add` counts: the cap asks
  // whether the candidate has the core stack, not whether the word is typed.
  primaryCovered: ['present', 'add'],
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
 * Either/or requirements folded to one entry each — mirror of score.ts:foldGroups
 * (ADR 0044). Entries sharing a `group` label are alternatives the posting
 * itself offered, so the score asks the question once.
 */
export function foldGroups(entries) {
  const out = [];
  const at = new Map();
  for (const e of entries) {
    const key = e.group ? String(e.group).trim().toLowerCase() : '';
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
    const held = out[seen];
    out[seen] = {
      ...held,
      requirement: strongerLevel(held.requirement, e.requirement),
      credit: Math.max(held.credit, e.credit),
      ceilCredit: Math.max(held.ceilCredit, e.ceilCredit),
      primary: held.primary || e.primary,
      primaryHit: held.primaryHit || e.primaryHit,
      primaryWritten: held.primaryWritten || e.primaryWritten,
      ceilPrimaryHit: held.ceilPrimaryHit || e.ceilPrimaryHit,
    };
  }
  return out;
}

function strongerLevel(a, b) {
  return (SCORING.requirementWeight[a] ?? 0) >= (SCORING.requirementWeight[b] ?? 0) ? a : b;
}

/**
 * entries: [{ requirement, primary, credit, primaryHit, ceilCredit,
 * ceilPrimaryHit, group }] — see score.ts. Flags duplicating missing primaries are
 * not counted and the penalty is bounded (v3); `ceiling` is the honest
 * maximum this resume can reach on this posting by editing alone.
 * Live estimates pass `fixedPenalty` (the analysis-time penalty): flag texts
 * were judged against the analysed snapshot, so typing a missing primary
 * into the editor must not re-inflate them.
 */
export function computeScore(rawEntries, alignment, countedFlags, fixedPenalty = null) {
  const entries = foldGroups(rawEntries);
  let earned = 0;
  let ceilEarned = 0;
  let total = 0;
  let primaryTotal = 0;
  let primaryPresent = 0;
  let primaryWritten = 0;
  let ceilPrimaryPresent = 0;
  for (const e of entries) {
    const weight = SCORING.requirementWeight[e.requirement] ?? 0;
    total += weight;
    earned += weight * Math.max(0, Math.min(1, e.credit));
    ceilEarned += weight * Math.max(0, Math.min(1, e.ceilCredit));
    if (e.primary) {
      primaryTotal++;
      if (e.primaryHit) primaryPresent++;
      if (e.primaryWritten) primaryWritten++;
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
  // Which flags reach the formula is decided by red-flags.ts before it — see
  // score.ts. The live estimate passes the analysis-time penalty anyway.
  const flagsCounted = Math.max(0, countedFlags);
  const penalty =
    fixedPenalty ?? Math.min(flagsCounted * SCORING.redFlagPenalty, SCORING.penaltyMax);
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
    primaryWritten,
    cap,
    score,
    ceiling,
    alignment: a ?? null,
  };
}

/**
 * Live entries from scoreKeywords() rows ({ requirement, primary, status, found }).
 * The server's own entries for the statuses THIS text implies — the rule
 * keyword-anchor.ts:anchorStatuses applies before every stored score (ADR
 * 0045): a word the text spells is `present`, whatever the last analysis
 * called it; a `present` or `add` the text does not spell is `add` (the facts
 * behind it stand, the word does not — half credit, and it still covers the
 * primary cap, so deleting a word never costs 49 points); an unwritten
 * `ask_user` or `cannot_claim` earns nothing until it is written or confirmed.
 * A "primary" mark only counts on must requirements, mirroring
 * entriesFromKeywords. score.test.ts holds the two sides equal on every text.
 */
export function entriesFromLive(rows) {
  return rows.map((r) => {
    const primary = r.primary === true && r.requirement === 'must';
    const written = r.found === true;
    const has = written || r.status === 'present' || r.status === 'add';
    return {
      requirement: r.requirement ?? 'preferred',
      primary,
      credit: written ? 1 : has ? 0.5 : 0,
      primaryHit: primary && has,
      primaryWritten: primary && written,
      ceilCredit: has ? 1 : 0,
      ceilPrimaryHit: primary && has,
      group: r.group ?? null,
    };
  });
}
