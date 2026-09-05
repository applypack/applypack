import type { ResumeMatch } from '@prisma/client';
import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import {
  buildSuggestionsPrompt,
  parseSuggestionsResponse,
  readHardRequirements,
  readKeywords,
  SUGGESTIONS_MAX_TOKENS,
  type MatchJobInput,
  type MatchSuggestions,
} from './prompts';
import { readBreakdown } from './score';
import { loadKeywordMatcher } from './keyword-matcher';
import { gateActions } from './replacement-gate';
import { listFacts, updateMatchSuggestions } from './store';

const SUGGESTIONS_TIMEOUT_MS = 5 * 60_000;

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
  const answer = await askForJson(
    await getAiRuntime(),
    { ...prompt, maxTokens: SUGGESTIONS_MAX_TOKENS, label: 'resume-suggestions', role: 'resume', timeoutMs: SUGGESTIONS_TIMEOUT_MS },
    // Every array defaults to empty, so "{}" parses — but a reply with nothing
    // in it would flip the row to "full" and lock the button out for good.
    (text) => {
      const parsed = parseSuggestionsResponse(text);
      return parsed.ok && isEmpty(parsed.data) ? { ok: false, error: 'empty reply' } : parsed;
    },
    { matchId: match.id },
  );
  if (!answer) return null;
  // The same gate the full report runs before it stores (ADR 0037).
  const gate = gateActions(answer.data.actions, {
    resumeText: match.resumeText,
    posting: `${job.title}\n${job.description}`,
    facts,
    keywords: readKeywords(match.keywords),
    matcher: await loadKeywordMatcher(),
  });
  const row = await updateMatchSuggestions(match.id, { ...answer.data, actions: gate.actions });
  logger.info(
    {
      matchId: match.id,
      jobId: match.jobId,
      resumeId: match.resumeId,
      actions: answer.data.actions.length,
      removals: answer.data.removals.length,
      replacementsBlocked: gate.blocked,
      replacementsWarned: gate.warned,
      model: answer.model,
      chars: answer.chars,
      ms: answer.ms,
    },
    'resume: suggestions added',
  );
  return row;
}

function isEmpty(s: MatchSuggestions): boolean {
  return s.actions.length + s.removals.length + s.strengths.length + s.cautions.length === 0;
}
