import type { ResumeMatch } from '@prisma/client';
import { config } from '../config';
import { logger } from '../logger';
import { getAiProvider } from '../ai-provider';
import { buildMatchPrompt, MATCH_MAX_TOKENS, parseMatchResponse, type MatchJobInput } from './prompts';
import { createMatch } from './store';

const MATCH_TIMEOUT_MS = 5 * 60_000;
const PARSE_ATTEMPTS = 2;

/**
 * One resume-vs-posting comparison, persisted as a ResumeMatch row. `resume.text`
 * is what gets judged — a stored version, or an unsaved draft from the editor
 * (`draft: true`). Null on AI failure.
 */
export async function matchResumeToJob(
  resume: { id: number; text: string; version: number },
  job: MatchJobInput & { id: number },
  opts: { draft?: boolean } = {},
): Promise<ResumeMatch | null> {
  const prompt = buildMatchPrompt(resume.text, job);
  const provider = getAiProvider();
  const model = config.CLAUDE_MODEL_RESUME;
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const text = await provider.complete({
      ...prompt,
      maxTokens: MATCH_MAX_TOKENS,
      label: 'resume-match',
      model,
      timeoutMs: MATCH_TIMEOUT_MS,
    });
    if (text === null) return null;
    const parsed = parseMatchResponse(text);
    if (parsed.ok) {
      const row = await createMatch({
        jobId: job.id,
        resumeId: resume.id,
        resumeVersion: resume.version,
        resumeText: resume.text,
        draft: opts.draft ?? false,
        model,
        result: parsed.data,
      });
      logger.info(
        { matchId: row.id, jobId: job.id, resumeId: resume.id, version: resume.version, draft: row.draft, score: row.matchScore },
        'resume: matched',
      );
      return row;
    }
    logger.warn(
      { jobId: job.id, resumeId: resume.id, attempt, error: parsed.error, raw: text.slice(0, 500) },
      'resume: match reply did not match schema',
    );
  }
  return null;
}
