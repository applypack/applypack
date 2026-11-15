import type { InterviewPrep } from '@prisma/client';
import { askForJson } from '../ai-json';
import { getAiRuntime } from '../ai-runtime';
import { logger } from '../logger';
import { getLatestCompanySnapshot, listFacts } from '../resume/store';
import type { InterviewLanguage } from './languages';
import {
  buildInterviewPrompt,
  INTERVIEW_MAX_TOKENS,
  INTERVIEW_PROMPT_VERSION,
  INTERVIEW_TIMEOUT_MS,
  parseInterviewResponse,
  settleQuestions,
  sourceKeyOf,
  type InterviewInput,
} from './prompts';
import { listCareerNotes, saveInterviewPrep } from './store';

/**
 * What the preparation of one posting reads (ADR 0065): the posting, the
 * person's notes, the resume they picked, the skills they confirmed and the
 * company as the last verification read it. Stored inputs only — no web
 * search, and nothing is asked of a model to gather them.
 */
async function interviewInput(
  job: InterviewInput['job'] & { id: number },
  language: InterviewLanguage,
  resume: { text: string } | null,
): Promise<InterviewInput> {
  const [notes, facts, companySnapshot] = await Promise.all([listCareerNotes(), listFacts(), getLatestCompanySnapshot(job.id)]);
  return {
    job,
    language,
    resumeText: resume?.text ?? null,
    notes: notes.map((n) => ({ title: n.title, text: n.text })),
    confirmedFacts: facts.filter((f) => f.status === 'confirmed').map((f) => ({ term: f.term, note: f.note })),
    companySnapshot,
  };
}

/** One call: the likely questions and the points to answer them with, stored as the job's preparation. Null when no engine answered. */
export async function prepareInterview(
  job: InterviewInput['job'] & { id: number },
  language: InterviewLanguage,
  resume: { id: number; text: string } | null,
): Promise<InterviewPrep | null> {
  const started = Date.now();
  const input = await interviewInput(job, language, resume);
  const ai = await getAiRuntime();
  const answer = await askForJson(
    ai,
    {
      ...buildInterviewPrompt(input),
      maxTokens: INTERVIEW_MAX_TOKENS,
      label: 'interview-prep',
      role: 'resume',
      timeoutMs: INTERVIEW_TIMEOUT_MS,
      subject: { jobId: job.id, resumeId: resume?.id },
    },
    parseInterviewResponse,
    { jobId: job.id },
  );
  if (!answer) return null;
  const questions = settleQuestions(answer.data, input);
  const row = await saveInterviewPrep({
    jobId: job.id,
    language: language.code,
    questions,
    sourceKey: sourceKeyOf(job.description, input.notes),
    model: answer.model,
    promptVersion: INTERVIEW_PROMPT_VERSION,
  });
  logger.info(
    {
      jobId: job.id,
      language: language.code,
      questions: questions.length,
      notes: input.notes.length,
      unbackedFigures: questions.reduce((n, q) => n + q.unbacked.length, 0),
      promptVersion: INTERVIEW_PROMPT_VERSION,
      ms: Date.now() - started,
    },
    'interview: prepared',
  );
  return row;
}
