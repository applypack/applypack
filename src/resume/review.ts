import type { ResumeReview } from '@prisma/client';
import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import { answerLines, readAnswers } from './answers';
import { parseWarnings } from './parse-warnings';
import {
  buildReviewPrompt,
  parseReviewResponse,
  REVIEW_MAX_TOKENS,
  REVIEW_PROMPT_VERSION,
  RESUME_TIMEOUT_MS,
} from './prompts';
import { scoreReview } from './review-score';
import { gateReviewAdvice } from './review-gate';
import { createReview } from './store';


/**
 * One strength review of one resume, judged on its own — no posting, no
 * comparison (docs/resumes-plan.md §B, ADR 0030). Null on AI failure.
 *
 * Same division of labour as the match (ADR 0012): the model grades six
 * dimensions and quotes its evidence, `review-score.ts` turns the grades into
 * the number with caps the prompt cannot talk its way past. The deterministic
 * ATS checks go INTO the prompt so the clarity grade argues with facts instead
 * of re-deriving them.
 */
export async function reviewResume(resume: {
  id: number;
  text: string;
  version: number;
  roleTypes: string[];
  /** Raw Resume.answers JSON — the figures an earlier run asked for (ADR 0030 phase 3). */
  answers?: unknown;
}, onError?: (reason: string) => void): Promise<ResumeReview | null> {
  const answers = readAnswers(resume.answers);
  const prompt = buildReviewPrompt(resume.text, {
    atsChecks: parseWarnings(resume.text).map((w) => w.message),
    roleTypes: resume.roleTypes,
    answers: answerLines(answers),
  });
  const answer = await askForJson(
    await getAiRuntime(),
    { ...prompt, maxTokens: REVIEW_MAX_TOKENS, label: 'resume-review', role: 'resume', timeoutMs: RESUME_TIMEOUT_MS.review, onError, subject: { resumeId: resume.id } },
    parseReviewResponse,
    { resumeId: resume.id },
  );
  if (!answer) return null;
  // An example that reaches past the resume becomes the question it needed (TASKS R3).
  const gate = gateReviewAdvice(answer.data.advice, [resume.text, ...answers.map((a) => `${a.question} ${a.answer}`)]);
  const review = { ...answer.data, advice: gate.advice };
  const breakdown = scoreReview(review.grades, review.advice.length);
  const row = await createReview({
    resumeId: resume.id,
    resumeVersion: resume.version,
    // The marker surfaces on the card: the user can see which engine judged them.
    model: answer.model,
    result: review,
    breakdown,
    promptVersion: REVIEW_PROMPT_VERSION,
  });
  logger.info(
    {
      reviewId: row.id,
      resumeId: resume.id,
      version: resume.version,
      score: row.reviewScore,
      raw: breakdown.rawPts,
      cap: breakdown.cap,
      weak: breakdown.weakCount,
      missing: breakdown.missing.length,
      advice: review.advice.length,
      asks: review.advice.filter((a) => a.ask !== null).length,
      examplesBlocked: gate.blocked,
      untrueDropped: gate.untrue,
      // The point of the loop: answered figures should make asks go down.
      answersUsed: answers.length,
      chars: answer.chars,
      ms: answer.ms,
    },
    'resume: reviewed',
  );
  return row;
}
