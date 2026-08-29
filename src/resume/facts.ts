import type { MatchKeyword } from './prompts';

/*
 * Deterministic post-processing of match keywords — no AI involved:
 *  - applyFacts: user-confirmed / denied CandidateFacts flip ask_user keywords
 *    instantly (and the score is recomputed by score.ts, not by a new AI call);
 *  - annotateElsewhere: a term this resume can't claim but another stored
 *    resume evidences gets an "elsewhere" pointer (blueprint: "you have it,
 *    but this resume hides it").
 * Pure: tested in facts.test.ts.
 */

export interface FactLike {
  term: string;
  status: string; // confirmed | denied
  note: string | null;
}

export function canonicalTerm(s: string): string {
  return s.trim().toLowerCase();
}

/** All names a keyword answers to, lowercase: the term + its aliases. */
function names(k: MatchKeyword): string[] {
  return [canonicalTerm(k.term), ...k.aliases];
}

/**
 * Flip keyword statuses from stored facts. Confirmed → "add" (the user's
 * context lands in the note); denied → "cannot_claim". Text evidence outranks
 * a denial: "present"/"add" keywords never get downgraded by a stale fact.
 */
export function applyFacts(
  keywords: MatchKeyword[],
  facts: FactLike[],
): { keywords: MatchKeyword[]; changed: number } {
  if (facts.length === 0) return { keywords, changed: 0 };
  const byName = new Map<string, FactLike>();
  for (const f of facts) byName.set(canonicalTerm(f.term), f);
  let changed = 0;
  const next = keywords.map((k) => {
    if (k.status !== 'ask_user' && k.status !== 'cannot_claim') return k;
    const fact = names(k)
      .map((n) => byName.get(n))
      .find((f) => f !== undefined);
    if (!fact) return k;
    if (fact.status === 'confirmed') {
      changed++;
      return { ...k, status: 'add' as const, note: fact.note ? `user-confirmed: ${fact.note}` : 'user-confirmed' };
    }
    if (fact.status === 'denied' && k.status === 'ask_user') {
      changed++;
      return { ...k, status: 'cannot_claim' as const, note: 'user: does not have it' };
    }
    return k;
  });
  return { keywords: next, changed };
}

/**
 * Point unclaimable keywords at another stored resume that evidences them,
 * via the scanned skill tags. Annotation only — the status stays honest for
 * THIS resume; the UI shows "in <resume>" as a safe-to-surface opportunity.
 */
export function annotateElsewhere(
  keywords: MatchKeyword[],
  otherSkills: { skill: string; resumeName: string }[],
): MatchKeyword[] {
  if (otherSkills.length === 0) return keywords;
  const byPart = new Map<string, string>();
  for (const s of otherSkills) {
    const key = canonicalTerm(s.skill);
    if (key.length > 0 && !byPart.has(key)) byPart.set(key, s.resumeName);
  }
  return keywords.map((k) => {
    if (k.status !== 'ask_user' && k.status !== 'cannot_claim') return k;
    const hit = names(k)
      .map((n) => byPart.get(n))
      .find((r) => r !== undefined);
    return hit ? { ...k, elsewhere: hit } : k;
  });
}
