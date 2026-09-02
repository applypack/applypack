import { canonicalTerm } from './facts';
import { withTableAliases } from './keyword-aliases';
import type { KeywordMatcher } from './keyword-matcher';
import type { MatchKeyword } from './prompts';
import type { RequirementLevel } from './score';

/*
 * The user's own say over the keyword list (target-plan.md §5). Three edits,
 * all deterministic and free: re-level what the posting demands (must ↔
 * preferred ↔ nice ↔ context), ignore a term as noise, add a term the model
 * missed. The model's own verdict is never overwritten — an override rides
 * beside it in the same `keywords` JSON, so the table can show both, "reset"
 * has something to go back to, and carryOverrides can re-apply the user's
 * edits to the next run's fresh list (the frame is per posting).
 *
 * `effectiveKeywords` is what everything downstream scores and highlights:
 * ignored rows dropped, re-levelled rows carrying the user's requirement.
 * score.ts is untouched — an override is a different input, not a different
 * formula. Pure: tested in keyword-overrides.test.ts.
 */

export interface KeywordOverride {
  /** Replaces the model's requirement level in every score and pane. */
  requirement?: RequirementLevel;
  /** Noise: out of the score, out of the highlights, kept in the table to undo. */
  excluded?: boolean;
  /** The user typed this row themselves — "reset" deletes it rather than restoring a verdict. */
  added?: boolean;
}

export type KeywordEditOp = 'level' | 'ignore' | 'restore' | 'reset';

export interface KeywordEdit {
  op: KeywordEditOp;
  term: string;
  /** Required by `level`, ignored by the rest. */
  requirement?: RequirementLevel;
}

export type EditResult =
  | {
      ok: true;
      keywords: MatchKeyword[];
      /** The row's own spelling — the edit may have been addressed by an alias. */
      term: string;
      /** The edit deleted the row: only a "reset" on a term the user added does that. */
      removed: boolean;
    }
  | { ok: false; error: string };

/** Context the two text-reading edits need; the matcher is the browser module (keyword-matcher.ts). */
export interface KeywordEditContext {
  resumeText: string;
  posting: string;
  matcher: KeywordMatcher;
}

const MAX_TERM_CHARS = 60;

/** A hand-added row still needs a priority: the same order the levels imply. */
const PRIORITY_BY_REQUIREMENT: Record<RequirementLevel, number> = {
  must: 1,
  preferred: 2,
  nice: 3,
  context: 4,
};

/** All names a keyword answers to, lowercase — the term plus its aliases. */
function names(k: MatchKeyword): string[] {
  return [canonicalTerm(k.term), ...k.aliases];
}

/** Empty overrides are not stored: `{}` and "no override" must read the same. */
function tidy(o: KeywordOverride): KeywordOverride | undefined {
  const next: KeywordOverride = {};
  if (o.requirement) next.requirement = o.requirement;
  if (o.excluded) next.excluded = true;
  if (o.added) next.added = true;
  return next.requirement !== undefined || next.excluded || next.added ? next : undefined;
}

function withOverride(k: MatchKeyword, patch: KeywordOverride): MatchKeyword {
  const next = tidy({ ...k.override, ...patch });
  return next ? { ...k, override: next } : withoutOverride(k);
}

function withoutOverride(k: MatchKeyword): MatchKeyword {
  if (!k.override) return k;
  const { override, ...rest } = k;
  return rest;
}

/** The level in force: the user's if they set one, the model's otherwise. */
export function effectiveRequirement(k: MatchKeyword): RequirementLevel {
  return k.override?.requirement ?? k.requirement;
}

export function isIgnored(k: MatchKeyword): boolean {
  return k.override?.excluded === true;
}

/**
 * What the score, the panes and the live editor work from: the user's levels,
 * without the rows they ignored. Everything else in the pipeline keeps taking
 * a plain keyword list and needs no idea overrides exist.
 */
export function effectiveKeywords<K extends MatchKeyword>(keywords: K[]): K[] {
  const kept = keywords.filter((k) => !isIgnored(k));
  return kept.map((k) => (k.override?.requirement ? { ...k, requirement: k.override.requirement } : k));
}

/** Re-level / ignore / restore / reset one row, addressed by term or alias. */
export function editKeyword(keywords: MatchKeyword[], edit: KeywordEdit): EditResult {
  const key = canonicalTerm(edit.term);
  const index = keywords.findIndex((k) => names(k).includes(key));
  const current = keywords[index];
  if (!current) return { ok: false, error: `"${edit.term}" is not in this comparison.` };

  if (edit.op === 'reset' && current.override?.added) {
    return { ok: true, keywords: keywords.filter((_, i) => i !== index), term: current.term, removed: true };
  }
  const patch: KeywordOverride =
    edit.op === 'level'
      ? // Choosing the model's own level again is a reset, not a "yours" badge.
        { requirement: edit.requirement === current.requirement ? undefined : edit.requirement }
      : edit.op === 'ignore'
        ? { excluded: true }
        : edit.op === 'restore'
          ? { excluded: false }
          : { requirement: undefined, excluded: false };
  const next = [...keywords];
  next[index] = withOverride(current, patch);
  return { ok: true, keywords: next, term: current.term, removed: false };
}

/**
 * A term the user says the posting wants. Status is read from the text, never
 * guessed: written in the resume → "present"; not written → "confirm you have
 * it", which the existing ask_user flow can then answer. A term the posting
 * does not literally contain is flagged `unanchored`, the same as a
 * paraphrase the model produced (keyword-anchor.ts).
 */
export function addKeyword(
  keywords: MatchKeyword[],
  input: { term: string; requirement: RequirementLevel },
  ctx: KeywordEditContext,
): EditResult {
  const term = input.term.trim().replace(/\s+/g, ' ').slice(0, MAX_TERM_CHARS);
  if (term.length === 0) return { ok: false, error: 'Type the keyword first.' };
  const key = canonicalTerm(term);
  const clash = keywords.find((k) => names(k).includes(key));
  if (clash) {
    return {
      ok: false,
      error: isIgnored(clash)
        ? `"${clash.term}" is already in the list — restore it instead.`
        : `"${clash.term}" is already in the list.`,
    };
  }
  const row = withTableAliases({
    term,
    priority: PRIORITY_BY_REQUIREMENT[input.requirement],
    requirement: input.requirement,
    primary: false,
    status: 'ask_user' as const,
    aliases: [] as string[],
    where: null,
    note: null,
    elsewhere: null,
    override: { added: true },
  });
  const found = ctx.matcher.findTerm(ctx.resumeText, row.term, row.aliases).length > 0;
  const inPosting = ctx.matcher.findTerm(ctx.posting, row.term, row.aliases).length > 0;
  const added: MatchKeyword = {
    ...row,
    status: found ? 'present' : 'ask_user',
    note: found ? 'added by you — already in this resume' : 'added by you — confirm whether you have it',
    ...(inPosting ? {} : { unanchored: true }),
  };
  return { ok: true, keywords: [...keywords, added], term: added.term, removed: false };
}

export interface CarryReport {
  keywords: MatchKeyword[];
  /** Rows of the fresh list that got a stored override back. */
  carried: number;
  /** Hand-added rows the fresh list did not contain, put back. */
  readded: number;
}

/**
 * Re-apply the stored overrides to a fresh reply, so they stick to the posting
 * across runs the way CONSISTENCY ACROSS RUNS makes the terms stick. The fresh
 * rows are stripped first: `override` is the user's field, and a posting that
 * talks the model into emitting one must not be able to drop a must-have from
 * the score (ADR 0022 covers the prompt, this covers the reply).
 *
 * Hand-added rows the model did not repeat are put back with their status read
 * from the CURRENT resume text — a term written in since the last run counts.
 */
export function carryOverrides(
  fresh: MatchKeyword[],
  previous: MatchKeyword[],
  ctx: KeywordEditContext,
): CarryReport {
  const stored = new Map<string, MatchKeyword>();
  for (const k of previous) {
    if (!k.override) continue;
    for (const name of names(k)) if (!stored.has(name)) stored.set(name, k);
  }
  let carried = 0;
  const seen = new Set<MatchKeyword>();
  const keywords = fresh.map((raw) => {
    const k = withoutOverride(raw);
    const hit = names(k)
      .map((n) => stored.get(n))
      .find((s) => s !== undefined);
    if (!hit) return k;
    seen.add(hit);
    // The model judged this one itself now, so "added" retires — but the level
    // the user picked for it is still theirs and rides on as an override. It
    // is kept even when this reply happens to agree: the point of an override
    // is that the level stops depending on what the model says next time.
    const next = tidy({
      requirement: hit.override?.requirement ?? (hit.override?.added ? hit.requirement : undefined),
      excluded: hit.override?.excluded,
    });
    if (!next) return k;
    carried++;
    return { ...k, override: next };
  });
  let readded = 0;
  for (const k of previous) {
    if (!k.override?.added || seen.has(k)) continue;
    readded++;
    const found = ctx.matcher.findTerm(ctx.resumeText, k.term, k.aliases).length > 0;
    keywords.push({
      ...k,
      status: found ? 'present' : 'ask_user',
      note: found ? 'added by you — already in this resume' : 'added by you — confirm whether you have it',
    });
  }
  return { keywords, carried, readded };
}
