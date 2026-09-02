import type { ResumeMatch } from '@prisma/client';
import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import {
  buildSuggestionsPrompt,
  parseSuggestionsResponse,
  readHardRequirements,
  readKeywords,
  SUGGESTIONS_MAX_TOKENS,
  type MatchJobInput,
} from './prompts';
import { readBreakdown } from './score';
import { listFacts, updateMatchSuggestions } from './store';

const SUGGESTIONS_TIMEOUT_MS = 5 * 60_000;
const PARSE_ATTEMPTS = 2;

/**
 * The lazy second half of a quick check (ADR 0029): the stored verdicts —
 * keywords, alignment, gates — go into the prompt unchanged, the model writes
 * only actions, removals, strengths and cautions, and the row becomes a full
 * analysis with the same score. Judged against the text the row analysed,
 * never the resume's current one. Null on AI failure.
 */
export async function suggestForMatch(match: ResumeMatch, job: MatchJobInput): Promise<ResumeMatch | null> {
  const facts = await listFacts();
  const prompt = buildSuggestionsPrompt(match.resumeText, job, {
    summary: match.summary,
    alignment: readBreakdown(match.breakdown)?.alignment ?? null,
    keywords: readKeywords(match.keywords),
    hardRequirements: readHardRequirements(match.hardRequirements),
    confirmedFacts: facts.filter((f) => f.status === 'confirmed').map((f) => ({ term: f.term, note: f.note })),
    deniedTerms: facts.filter((f) => f.status === 'denied').map((f) => f.term),
  });
  const ai = await getAiRuntime();
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const started = Date.now();
    const out = await ai.complete({
      ...prompt,
      maxTokens: SUGGESTIONS_MAX_TOKENS,
      label: 'resume-suggestions',
      role: 'resume',
      timeoutMs: SUGGESTIONS_TIMEOUT_MS,
    });
    if (out === null) return null;
    const parsed = parseSuggestionsResponse(out.text);
    if (parsed.ok) {
      const row = await updateMatchSuggestions(match.id, { suggestions: parsed.data, breakdown: match.breakdown });
      logger.info(
        {
          matchId: match.id,
          jobId: match.jobId,
          resumeId: match.resumeId,
          actions: parsed.data.actions.length,
          removals: parsed.data.removals.length,
          model: out.model || out.providerId,
          chars: out.text.length,
          ms: Date.now() - started,
        },
        'resume: suggestions added',
      );
      return row;
    }
    logger.warn(
      { matchId: match.id, attempt, error: parsed.error, raw: out.text.slice(0, 500) },
      'resume: suggestions reply did not match schema',
    );
  }
  return null;
}
