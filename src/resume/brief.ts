import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import { hashShortId } from '../text-utils';
import {
  BRIEF_MAX_TOKENS,
  BRIEF_PROMPT_VERSION,
  buildBriefPrompt,
  parseBriefResponse,
  RESUME_TIMEOUT_MS,
  type MatchJobInput,
  type PostingBrief,
} from './prompts';
import { createPostingBrief, getPostingBrief } from './store';

/*
 * The posting read once, on its own (ADR 0044). No resume reaches this call,
 * so the answer is a property of the POSTING: it survives every resume edit
 * and is stored against the text it was written from.
 *
 * The match and the suggestions both read it — the match for the keyword frame
 * and the requirement groups, the suggestions for who reads this resume first
 * and what would impress them. Both degrade to their old behaviour when it is
 * null, so a failed or skipped brief costs the user nothing but the context.
 */

/** What a stored brief is keyed by: the posting text this reading was made from. */
export function postingHashOf(job: Pick<MatchJobInput, 'title' | 'description'>): string {
  return hashShortId(`${job.title}\n${job.description}`);
}

/**
 * The stored brief for this posting, or null — never a model call. Pages read
 * it to say what the posting itself carried (brief-depth.ts); rendering a page
 * must not spend a comparison's worth of tokens.
 */
export async function storedBriefFor(job: MatchJobInput & { id: number }): Promise<PostingBrief | null> {
  const stored = await getPostingBrief(job.id, postingHashOf(job), BRIEF_PROMPT_VERSION);
  if (!stored) return null;
  const parsed = parseBriefResponse(JSON.stringify(stored.brief));
  return parsed.ok ? parsed.data : null;
}

export interface BriefResult {
  brief: PostingBrief;
  /** True when the brief came from the store — no model call was made. */
  reused: boolean;
}

/**
 * The brief for this posting: the stored one when the text and the brief
 * version both match, otherwise a fresh reading, stored. Null only when the
 * model call fails — callers carry on without it.
 */
export async function briefForPosting(
  job: MatchJobInput & { id: number },
  opts: { onError?: (reason: string) => void } = {},
): Promise<BriefResult | null> {
  const postingHash = postingHashOf(job);
  const stored = await getPostingBrief(job.id, postingHash, BRIEF_PROMPT_VERSION);
  if (stored) {
    // A row written by an older schema still has to satisfy today's parser —
    // the reuse is only worth having if what comes back is the shape callers expect.
    const parsed = parseBriefResponse(JSON.stringify(stored.brief));
    if (parsed.ok) {
      logger.info({ jobId: job.id, briefId: stored.id, model: stored.model }, 'resume: brief reused');
      return { brief: parsed.data, reused: true };
    }
    logger.warn({ jobId: job.id, briefId: stored.id, error: parsed.error }, 'resume: stored brief unreadable, rewriting');
  }

  const answer = await askForJson(
    await getAiRuntime(),
    {
      ...buildBriefPrompt(job),
      maxTokens: BRIEF_MAX_TOKENS,
      label: 'posting-brief',
      role: 'resume',
      timeoutMs: RESUME_TIMEOUT_MS.brief,
      onError: opts.onError,
    },
    parseBriefResponse,
    { jobId: job.id },
  );
  if (!answer) return null;

  const row = await createPostingBrief({
    jobId: job.id,
    model: answer.model,
    promptVersion: BRIEF_PROMPT_VERSION,
    postingHash,
    brief: answer.data,
  });
  logger.info(
    {
      briefId: row.id,
      jobId: job.id,
      model: answer.model,
      family: answer.data.role.family,
      seniority: answer.data.role.seniority,
      industry: answer.data.company.industry,
      keywords: answer.data.keywords.length,
      groups: answer.data.requirement_groups.length,
      chars: answer.chars,
      ms: answer.ms,
    },
    'resume: posting briefed',
  );
  return { brief: answer.data, reused: false };
}

/** One line for the progress page: what the reading found, in the user's words. */
export function briefLine(brief: PostingBrief): string {
  const parts = [brief.role.family];
  if (brief.role.seniority) parts.push(`${brief.role.seniority} level`);
  if (brief.company.industry) parts.push(brief.company.industry);
  const groups = brief.requirement_groups.length;
  const tail = `${brief.keywords.length} keywords${groups > 0 ? `, ${groups} either/or requirement${groups === 1 ? '' : 's'}` : ''}`;
  return `${parts.filter(Boolean).join(' · ')} — ${tail}`;
}
