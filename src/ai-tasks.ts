import type { AiRole } from './ai-engine';
import type { AiFeature } from './ai-usage';

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

export const AI_TASK_LABELS: Record<AiTask, string> = {
  scoring: 'Scoring postings',
  'resume-read': 'Reading a resume',
  analysis: 'Resume analysis',
  letters: 'Cover letters',
  verify: 'Is it real?',
  screening: 'Screening applicants',
};

/** What each task covers, one sentence under its name. */
export const AI_TASK_DESCS: Record<AiTask, string> = {
  scoring: 'The score of every new posting, the two-stage prefilter, and reading a posting you paste.',
  'resume-read': 'The scan after an upload, and the shape read for the clean version.',
  analysis: 'The posting brief, the comparison, the edit suggestions and rewrites, the strength review.',
  letters: 'Writing a cover letter.',
  verify: 'The deep check of a posting, which searches the web.',
  screening: 'Employer mode: scoring applicants and comparing a shortlist.',
};

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
