import { AI_PROVIDER_LABELS, taskPlans, type AiProviderId, type ResolvedAiEngine } from '../ai-engine';
import { AI_TASK_DESCS, AI_TASK_LABELS, AI_TASK_ROLE, type AiTask } from '../ai-tasks';
import type { AiBilling } from '../ai-usage';

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

export function aiPlanRows(engine: ResolvedAiEngine, billingFor: (id: AiProviderId) => AiBilling, employerMode: boolean): AiPlanRow[] {
  return taskPlans(engine)
    .filter((p) => taskShown(p.task, employerMode))
    .map((p) => ({
      task: p.task,
      label: AI_TASK_LABELS[p.task],
      desc: AI_TASK_DESCS[p.task],
      unclaimed: p.unclaimed,
      engines: p.engines.map((id) => ({
        id,
        label: AI_PROVIDER_LABELS[id],
        model: engine.modelFor(id, AI_TASK_ROLE[p.task]) || 'CLI default',
        billing: billingFor(id),
      })),
    }));
}
