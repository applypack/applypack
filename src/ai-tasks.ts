import type { AiRole } from './ai-engine';
import type { AiFeature } from './ai-usage';
import type { MessageKey } from './i18n/catalog';
import { t } from './i18n/t';

/*
 * The kinds of work an engine can be given (ADR 0060). A task is a group of
 * AI features a person would hand to one model together: the ledger keeps
 * its seventeen features, the AI tab asks about six tasks. Pure.
 */

export const AI_TASKS = ['scoring', 'resume-read', 'analysis', 'letters', 'verify', 'screening'] as const;
export type AiTask = (typeof AI_TASKS)[number];

export function isAiTask(value: unknown): value is AiTask {
  return typeof value === 'string' && (AI_TASKS as readonly string[]).includes(value);
}

const TASK_LABEL = {
  scoring: 'plan.task.scoring',
  'resume-read': 'plan.task.resumeRead',
  analysis: 'plan.task.analysis',
  letters: 'plan.task.letters',
  verify: 'plan.task.verify',
  screening: 'plan.task.screening',
} as const satisfies Record<AiTask, MessageKey>;

/** What each task covers, one sentence under its name. */
const TASK_DESC = {
  scoring: 'plan.taskDesc.scoring',
  'resume-read': 'plan.taskDesc.resumeRead',
  analysis: 'plan.taskDesc.analysis',
  letters: 'plan.taskDesc.letters',
  verify: 'plan.taskDesc.verify',
  screening: 'plan.taskDesc.screening',
} as const satisfies Record<AiTask, MessageKey>;

/** A task's name in the reader's language. */
export function taskLabel(task: AiTask): string {
  return t(TASK_LABEL[task]);
}

export function taskDesc(task: AiTask): string {
  return t(TASK_DESC[task]);
}

/** The model slot a task's calls read on each engine card. */
export const AI_TASK_ROLE: Record<AiTask, AiRole> = {
  scoring: 'classifier',
  'resume-read': 'resume',
  analysis: 'resume',
  letters: 'cover',
  verify: 'resume',
  screening: 'resume',
};

/** A new feature does not compile until it says which task it belongs to; null = sent to one engine by hand. */
const TASK_OF: Record<AiFeature, AiTask | null> = {
  classifier: 'scoring',
  prefilter: 'scoring',
  'posting-extract': 'scoring',
  'posting-brief': 'analysis',
  'resume-scan': 'resume-read',
  'resume-structure': 'resume-read',
  'resume-match': 'analysis',
  'resume-match-fast': 'analysis',
  'resume-suggestions': 'analysis',
  'resume-rewrite': 'analysis',
  'resume-review': 'analysis',
  'cover-letter': 'letters',
  'job-verify': 'verify',
  screening: 'screening',
  'screening-compare': 'screening',
  'screening-bench': 'screening',
  'engine-test': null,
};

export function taskOf(feature: AiFeature): AiTask | null {
  return TASK_OF[feature];
}
