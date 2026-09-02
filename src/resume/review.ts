import type { ResumeReview } from '@prisma/client';
import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { answerLines, readAnswers } from './answers';
import { parseWarnings } from './parse-warnings';
import {
  buildReviewPrompt,
  parseReviewResponse,
  REVIEW_MAX_TOKENS,
  REVIEW_PROMPT_VERSION,
} from './prompts';
import { scoreReview } from './review-score';
import { createReview } from './store';

const REVIEW_TIMEOUT_MS = 5 * 60_000;
const PARSE_ATTEMPTS = 2;

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
}): Promise<ResumeReview | null> {
  const answers = readAnswers(resume.answers);
  const prompt = buildReviewPrompt(resume.text, {
    atsChecks: parseWarnings(resume.text).map((w) => w.message),
    roleTypes: resume.roleTypes,
    answers: answerLines(answers),
  });
  const ai = await getAiRuntime();
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const started = Date.now();
    const out = await ai.complete({
      ...prompt,
      maxTokens: REVIEW_MAX_TOKENS,
      label: 'resume-review',
      role: 'resume',
      timeoutMs: REVIEW_TIMEOUT_MS,
    });
    if (out === null) return null;
    const parsed = parseReviewResponse(out.text);
    if (parsed.ok) {
      const breakdown = scoreReview(parsed.data.grades);
      const row = await createReview({
        resumeId: resume.id,
        resumeVersion: resume.version,
        // The marker surfaces on the card: the user can see which engine judged them.
        model: (out.model || out.providerId) + (out.viaFallback ? ' · fallback' : ''),
        result: parsed.data,
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
          advice: parsed.data.advice.length,
          asks: parsed.data.advice.filter((a) => a.ask !== null).length,
          // The point of the loop: answered figures should make asks go down.
          answersUsed: answers.length,
          chars: out.text.length,
          ms: Date.now() - started,
        },
        'resume: reviewed',
      );
      return row;
    }
    logger.warn(
      { resumeId: resume.id, attempt, error: parsed.error, raw: out.text.slice(0, 500) },
      'resume: review reply did not match schema',
    );
  }
  return null;
}
