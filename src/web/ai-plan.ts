import { AI_PROVIDER_LABELS, taskPlans, type AiProviderId, type ResolvedAiEngine } from '../ai-engine';
import { AI_TASK_ROLE, taskDesc, taskLabel, type AiTask } from '../ai-tasks';
import type { AiBilling } from '../ai-usage';
import { t } from '../i18n/t';

/*
 * Who does what, as the AI tab and the AI usage page both draw it (ADR 0060):
 * each task with the engine and model that answer it first and the ones
 * behind. Pure.
 */

export interface AiPlanRow {
  task: AiTask;
  label: string;
  desc: string;
  /** No usable engine takes it, so every engine in the list may answer. */
  unclaimed: boolean;
  engines: { id: AiProviderId; label: string; model: string; billing: AiBilling }[];
}

/** Screening is a task only while employer mode is on. */
export function taskShown(task: AiTask, employerMode: boolean): boolean {
  return task !== 'screening' || employerMode;
}

/**
 * The boxes a save sent, as the tasks they stand for. While the page hides
 * Screening, an engine that already has a list keeps the choice in it — it
 * may have been made on purpose, with the box in sight. An engine with no
 * list yet gets Screening where Resume analysis goes, the same kind of
 * reading on the same model slot: one narrowed to scoring is never handed
 * other people's resumes by a box nobody could see.
 */
export function pickedTasks(sent: readonly AiTask[], employerMode: boolean, previous: readonly AiTask[] | undefined): AiTask[] {
  if (employerMode) return [...sent];
  const shown = sent.filter((task) => task !== 'screening');
  const screening = previous ? previous.includes('screening') : shown.includes('analysis');
  return screening ? [...shown, 'screening'] : shown;
}

/**
 * What a save of an engine's task boxes says back, in the tasks the page
 * shows: a list that holds only a hidden task reads as the empty row of
 * boxes the user is looking at.
 */
export function tasksSaved(engine: string, list: readonly AiTask[] | undefined, employerMode: boolean): string {
  if (list === undefined) return t('plan.saved.every', { engine });
  const shown = list.filter((task) => taskShown(task, employerMode));
  return shown.length === 0
    ? t('plan.saved.none', { engine })
    : t('plan.saved.some', { engine, tasks: shown.map(taskLabel).join(', ') });
}

export function aiPlanRows(engine: ResolvedAiEngine, billingFor: (id: AiProviderId) => AiBilling, employerMode: boolean): AiPlanRow[] {
  return taskPlans(engine)
    .filter((p) => taskShown(p.task, employerMode))
    .map((p) => ({
      task: p.task,
      label: taskLabel(p.task),
      desc: taskDesc(p.task),
      unclaimed: p.unclaimed,
      engines: p.engines.map((id) => ({
        id,
        label: AI_PROVIDER_LABELS[id],
        model: engine.modelFor(id, AI_TASK_ROLE[p.task]) || t('ai.cliDefault'),
        billing: billingFor(id),
      })),
    }));
}

/**
 * The plan in one or two sentences, for the top of the AI & costs tab: who
 * answers when one engine answers everything, and who stands behind it.
 * Null when a task has no engine at all — the tab's own warning says that.
 */
export function planSummary(rows: readonly AiPlanRow[]): { lead: string; fallback: string | null } | null {
  if (rows.length === 0 || rows.some((r) => r.engines.length === 0)) return null;
  const firsts = new Set(rows.map((r) => r.engines[0]!.id));
  if (firsts.size > 1) return { lead: t('plan.summary.split', { n: firsts.size }), fallback: null };
  const first = rows[0]!.engines[0]!;
  // The engine behind it, when every task that has one has the same: a task no other engine can take
  // (the web check, where only one engine searches) has none, and says nothing against it.
  const behind = rows.flatMap((r) => (r.engines[1] ? [r.engines[1]] : []));
  const second = behind.length > 0 && behind.every((e) => e.id === behind[0]!.id) ? behind[0] : undefined;
  return {
    lead: t('plan.summary.one', { engine: first.label, billing: first.billing }),
    fallback: second ? t('plan.summary.fallback', { engine: second.label }) : null,
  };
}
