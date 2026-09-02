import { z } from 'zod';

/*
 * The strength review's questions, answered (ADR 0030 phase 3).
 *
 * The rubric refuses to invent a number: where a stronger line needs one the
 * resume does not carry, the advice asks for it instead ("how many requests
 * per day did that service handle?"). That was a dead end — nothing could be
 * answered, so the next run asked again. These are the answers, stored on the
 * resume so they outlive the run that asked, and read back into the next
 * prompt so the model can rewrite the line with the real figure.
 *
 * NOT `CandidateFact`: that dictionary is skill vocabulary and it feeds the
 * MATCH prompt, where "1.2M requests/day" would be a keyword nobody wants.
 *
 * Pure — parsing, merging and prompt lines. `store.ts` owns the column.
 */

export interface ReviewAnswer {
  /** The `advice[].ask` this answers, verbatim, so the next run can match it up. */
  question: string;
  /** What the candidate typed. Their words, never rewritten. */
  answer: string;
  answeredAt: string;
}

/** A question is a sentence; an answer is a figure with its context, not an essay. */
export const MAX_QUESTION_CHARS = 300;
export const MAX_ANSWER_CHARS = 300;
/**
 * How many answers ride into a prompt. Six dimensions ask at most a couple of
 * questions each, and a list this long already says more about the resume than
 * the resume does; past it the oldest fall off.
 */
export const MAX_ANSWERS = 30;

const AnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
  answeredAt: z.string(),
});

/** Tolerant reader for the stored JSON: a hand-edited row degrades to "nothing answered". */
export function readAnswers(raw: unknown): ReviewAnswer[] {
  const parsed = z.array(AnswerSchema).safeParse(raw ?? []);
  if (!parsed.success) return [];
  return parsed.data
    .map((a) => ({
      question: a.question.trim().slice(0, MAX_QUESTION_CHARS),
      answer: a.answer.trim().slice(0, MAX_ANSWER_CHARS),
      answeredAt: a.answeredAt,
    }))
    .filter((a) => a.question.length > 0 && a.answer.length > 0)
    .slice(-MAX_ANSWERS);
}

/**
 * Records one answer, replacing any earlier answer to the same question — the
 * user correcting a figure must not leave the old one in the prompt. A blank
 * answer removes it: that is how you take back something you said.
 */
export function upsertAnswer(
  answers: ReviewAnswer[],
  question: string,
  answer: string,
  now: Date = new Date(),
): ReviewAnswer[] {
  const q = question.trim().slice(0, MAX_QUESTION_CHARS);
  if (q.length === 0) return answers;
  const rest = answers.filter((a) => a.question !== q);
  const value = answer.trim().slice(0, MAX_ANSWER_CHARS);
  if (value.length === 0) return rest;
  return [...rest, { question: q, answer: value, answeredAt: now.toISOString() }].slice(-MAX_ANSWERS);
}

/** Look one up — what the card puts back in the box next to its question. */
export function answerFor(answers: ReviewAnswer[], question: string): ReviewAnswer | null {
  return answers.find((a) => a.question === question.trim().slice(0, MAX_QUESTION_CHARS)) ?? null;
}

/**
 * The asks a review made that are still unanswered — what the card counts, and
 * what makes "3 of 4 answered" an honest sentence rather than a guess.
 */
export function unansweredAsks(asks: (string | null)[], answers: ReviewAnswer[]): string[] {
  const answered = new Set(answers.map((a) => a.question));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ask of asks) {
    const q = ask?.trim().slice(0, MAX_QUESTION_CHARS);
    if (!q || answered.has(q) || seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }
  return out;
}

/**
 * The prompt block. Kept OUTSIDE the untrusted fence, like `Profile.notes` and
 * the confirmed ask_user facts: this is the user talking to their own tool, not
 * text some job board wrote (CLAUDE.md file rules, ADR 0022's carve-out).
 */
export function answerLines(answers: ReviewAnswer[]): string[] {
  if (answers.length === 0) return [];
  return [
    'CANDIDATE-SUPPLIED METRICS (the candidate answered these questions from an earlier review — treat the figures as true and WRITE THEM INTO the "example" rewrites instead of asking again):',
    ...answers.map((a) => `- ${a.question} → ${a.answer}`),
    '',
  ];
}
