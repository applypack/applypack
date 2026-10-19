import { AI_TASKS, taskLabel, taskOf, type AiTask } from '../ai-tasks';
import type { WindowAttempt } from '../ai-ledger';
import type { AiFeature } from '../ai-usage';
import { t } from '../i18n/t';

/*
 * A task whose prompt did not fit an engine's context window (#411): read off
 * the ledger's `too_large` attempts — the local engine refuses such a prompt
 * before it sends it (ADR 0057) — and the attempt the engine behind made right
 * after each one. Pure; the rows come from ai-ledger.ts:loadWindowRefusals.
 */

/** How far back the engine card looks. */
const MISFIT_DAYS = 30;
/**
 * How soon after a refusal the next engine's attempt starts: at once, the
 * prompt was never sent — only the refusal's ledger row is written between.
 */
const FOLLOW_MS = 5_000;
const TOKENS_PER_K = 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the card's look back starts. */
export function misfitSince(now: Date): Date {
  return new Date(now.getTime() - MISFIT_DAYS * DAY_MS);
}

export interface Misfit {
  task: AiTask;
  /** Calls of this task the engine refused as too large for its window. */
  refused: number;
  /** Of those, the ones an engine behind it answered. */
  answered: number;
}

/**
 * The tasks `engine` could not fit, in the AI tab's order. A refusal counts as
 * answered when another engine's fallback attempt at the same feature started
 * within moments of it and answered; each such attempt answers one refusal
 * only, so three refused at once need three answers.
 */
export function windowMisfits(engine: string, refusals: readonly WindowAttempt[], fallbacks: readonly WindowAttempt[]): Misfit[] {
  const used = new Set<WindowAttempt>();
  const byTask = new Map<AiTask, Misfit>();
  const mine = refusals.filter((r) => r.engine === engine && r.outcome === 'too_large').sort((a, b) => a.at.getTime() - b.at.getTime());
  const answers = fallbacks.filter((f) => f.engine !== engine && f.outcome === 'ok').sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const refusal of mine) {
    const task = taskOf(refusal.feature as AiFeature) ?? null;
    if (!task) continue;
    const from = refusal.at.getTime();
    const until = from + refusal.durationMs + FOLLOW_MS;
    const answer = answers.find((f) => !used.has(f) && f.feature === refusal.feature && f.at.getTime() >= from && f.at.getTime() <= until);
    if (answer) used.add(answer);
    const misfit = byTask.get(task) ?? { task, refused: 0, answered: 0 };
    misfit.refused++;
    if (answer) misfit.answered++;
    byTask.set(task, misfit);
  }
  return AI_TASKS.flatMap((task) => byTask.get(task) ?? []);
}

/** One sentence on the engine card; `windowTokens` is the window when the engine's is known (the local one). */
export function misfitLine(misfit: Misfit, windowTokens: number | null): string {
  const params = {
    task: taskLabel(misfit.task),
    sized: windowTokens === null ? 'no' : 'yes',
    k: windowTokens === null ? 0 : Math.round(windowTokens / TOKENS_PER_K),
    n: misfit.refused,
    days: MISFIT_DAYS,
    answered: misfit.answered,
  };
  if (misfit.answered === misfit.refused) return t('engine.misfit.behind', params);
  return t(misfit.answered === 0 ? 'engine.misfit.failed' : 'engine.misfit.some', params);
}
