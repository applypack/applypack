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
