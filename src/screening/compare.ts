import type { Applicant } from '@prisma/client';
import { logger } from '../logger';
import type { AiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import type { KeywordMatcher } from '../resume/keyword-matcher';
import { anchorCompareReply, secondOrder, type StoredComparison } from './comparison';
import { buildComparePrompt, COMPARE_MAX_TOKENS, COMPARE_PROMPT_VERSION, COMPARE_TIMEOUT_MS, parseCompareResponse } from './prompts';
import { createComparison, postingOf, type ScreeningWithJob } from './store';
import type { Rubric } from './rubric';

/*
 * Compare with AI, the call (plan §5.1, ADR 0051): one shortlist, two calls
 * at once — the second with the resumes in the reverse order — each reply
 * anchored to the texts it read, both stored as one row. Web-only.
 */

export type CompareOutcome = { ok: true; id: number } | { ok: false; reason: string };

type Shortlisted = Pick<Applicant, 'id' | 'number' | 'redactedText'>;

export async function compareApplicants(
  screening: ScreeningWithJob,
  rubric: Rubric,
  applicants: Shortlisted[],
  runtime: Pick<AiRuntime, 'complete'>,
  matcher: Pick<KeywordMatcher, 'locateQuote'>,
): Promise<CompareOutcome> {
  const texts = new Map(applicants.map((a) => [a.number, a.redactedText]));
  const ids = applicants.map((a) => a.id);
  let reason = '';
  const reading = async (shown: Shortlisted[]) => {
    const answer = await askForJson(
      runtime,
      {
        ...buildComparePrompt({ rubric, job: postingOf(screening), applicants: shown.map((a) => ({ number: a.number, text: a.redactedText })) }),
        maxTokens: COMPARE_MAX_TOKENS,
        label: 'screening-compare',
        role: 'resume',
        timeoutMs: COMPARE_TIMEOUT_MS,
        onError: (r) => {
          reason = r;
        },
      },
      parseCompareResponse,
      { screeningId: screening.id, ids },
    );
    if (!answer) return null;
    const anchored = anchorCompareReply(answer.data, texts, rubric, matcher);
    logger.info(
      { screeningId: screening.id, ids, shown: shown.map((a) => a.number), ...anchored.report, injection: anchored.reply.injection, model: answer.model, chars: answer.chars, ms: answer.ms },
      'screening: shortlist read',
    );
    return { shown: shown.map((a) => a.number), reply: anchored.reply, model: answer.model };
  };
  try {
    const [a, b] = await Promise.all([reading(applicants), reading(secondOrder(applicants))]);
    if (!a || !b) return { ok: false, reason: reason || 'no engine answered' };
    const readings: StoredComparison = { v: 1, readings: [{ shown: a.shown, reply: a.reply }, { shown: b.shown, reply: b.reply }] };
    const row = await createComparison({
      screeningId: screening.id,
      applicantIds: ids,
      rubricVersion: screening.rubricVersion,
      promptVersion: COMPARE_PROMPT_VERSION,
      model: a.model,
      readings,
    });
    return { ok: true, id: row.id };
  } catch (err) {
    logger.error({ err, screeningId: screening.id, ids }, 'screening: comparison failed');
    return { ok: false, reason: reason || (err instanceof Error ? err.message : 'unexpected failure') };
  }
}
