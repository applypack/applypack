/*
 * Whether an engine is failing NOW, read off the ledger's last rows (#413).
 *
 * The probe behind "available" reads what is on disk — a binary, a key, a
 * model list — and says nothing about whether calls get through. And the
 * usage page weighs failures over its whole period, so twenty refusals in a
 * row sat under a week of successes and the page stayed green while scoring
 * was dead. An engine's last attempts answer the question both miss.
 *
 * Pure: the rows are handed in (ai-ledger.ts:loadRecentAttempts), newest
 * first.
 */

/** One attempt as the ledger keeps it. `outcome` is a string on purpose: a row is read as stored. */
export interface RecentAttempt {
  engine: string;
  outcome: string;
  at: Date;
}

/**
 * What the failures have in common, as far as the advice differs:
 * `signin` a refused key or sign-in · `unreachable` no server answered ·
 * `window` the prompt was larger than the model's context window ·
 * `limited` a rate limit or a spent allowance · `failing` anything else.
 */
export type TroubleKind = 'signin' | 'unreachable' | 'window' | 'limited' | 'failing';

export interface EngineTrouble {
  engine: string;
  kind: TroubleKind;
  /** How many attempts in a row failed, counted back from the newest. */
  failed: number;
  /** When the run of failures began. */
  since: Date;
}

/** Failures in a row that make a pattern. Fewer is one bad call and the retry that followed it. */
export const TROUBLE_STREAK = 3;

const KIND_OF: Record<string, TroubleKind> = {
  unauthorized: 'signin',
  unreachable: 'unreachable',
  too_large: 'window',
  rate_limited: 'limited',
};

/** The commonest outcome of a run; the newest breaks a tie, being the likeliest to describe the next call. */
function commonest(outcomes: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const o of outcomes) counts.set(o, (counts.get(o) ?? 0) + 1);
  let best = outcomes[0]!;
  for (const o of outcomes) if ((counts.get(o) ?? 0) > (counts.get(best) ?? 0)) best = o;
  return best;
}

/**
 * One engine's attempts, newest first → what is wrong with it, or null.
 *
 * A refused sign-in needs no pattern: the chain stops asking that engine
 * until its credential changes (ai-cooldown.ts), so one row is all there
 * will ever be. Anything else is trouble from `TROUBLE_STREAK` failures in a
 * row; one answered call in between and the engine is working.
 */
export function engineTrouble(attempts: readonly RecentAttempt[]): EngineTrouble | null {
  const answered = attempts.findIndex((a) => a.outcome === 'ok');
  const run = answered === -1 ? attempts : attempts.slice(0, answered);
  const newest = run[0];
  if (!newest) return null;
  const refused = newest.outcome === 'unauthorized';
  if (!refused && run.length < TROUBLE_STREAK) return null;
  const kind = refused ? 'signin' : (KIND_OF[commonest(run.map((a) => a.outcome))] ?? 'failing');
  return { engine: newest.engine, kind, failed: run.length, since: run[run.length - 1]!.at };
}

/** Every engine in trouble, from a list that holds each engine's attempts newest first (in any order between engines). */
export function engineTroubles(attempts: readonly RecentAttempt[]): EngineTrouble[] {
  const byEngine = new Map<string, RecentAttempt[]>();
  for (const a of attempts) byEngine.set(a.engine, [...(byEngine.get(a.engine) ?? []), a]);
  return [...byEngine.values()].map(engineTrouble).filter((t): t is EngineTrouble => t !== null);
}
