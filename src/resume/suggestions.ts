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
  RESUME_TIMEOUT_MS,
} from './prompts';
import { readBreakdown } from './score';
import { loadKeywordMatcher } from './keyword-matcher';
import { gateActions, gateRemovals } from './replacement-gate';
import { getLatestVerificationContext, listFacts, updateMatchSuggestions } from './store';


/**
 * The lazy second half of a quick check (ADR 0029): the stored verdicts —
 * keywords, alignment, gates — go into the prompt unchanged, the model writes
 * only actions, removals, strengths and cautions, and the row becomes a full
 * analysis with the same score. Judged against the text the row analysed,
 * never the resume's current one. Null on AI failure.
 */
export async function suggestForMatch(
  match: ResumeMatch,
  job: MatchJobInput & { id: number },
  onError?: (reason: string) => void,
): Promise<ResumeMatch | null> {
  const [facts, verification] = await Promise.all([listFacts(), getLatestVerificationContext(job.id)]);
  const prompt = buildSuggestionsPrompt(match.resumeText, job, {
    summary: match.summary,
    alignment: readBreakdown(match.breakdown)?.alignment ?? null,
    keywords: readKeywords(match.keywords),
    hardRequirements: readHardRequirements(match.hardRequirements),
    confirmedFacts: facts.filter((f) => f.status === 'confirmed').map((f) => ({ term: f.term, note: f.note })),
    deniedTerms: facts.filter((f) => f.status === 'denied').map((f) => f.term),
    // Context for the "why" lines, never evidence (ADR 0042).
    companySnapshot: verification?.snapshot ?? null,
  });
  const answer = await askForJson(
    await getAiRuntime(),
    { ...prompt, maxTokens: SUGGESTIONS_MAX_TOKENS, label: 'resume-suggestions', role: 'resume', timeoutMs: RESUME_TIMEOUT_MS.suggestions, onError },
    // Every array defaults to empty, so "{}" parses — but a reply with nothing
    // in it would flip the row to "full" and lock the button out for good.
    (text) => {
      const parsed = parseSuggestionsResponse(text);
      return parsed.ok && isEmpty(parsed.data) ? { ok: false, error: 'empty reply' } : parsed;
    },
    { matchId: match.id },
  );
  if (!answer) return null;
  // The same gates the full report runs before it stores (ADR 0037).
  const gateSources = {
    resumeText: match.resumeText,
    posting: `${job.title}\n${job.description}`,
    facts,
    keywords: readKeywords(match.keywords),
    matcher: await loadKeywordMatcher(),
  };
  const gate = gateActions(answer.data.actions, gateSources);
  const cuts = gateRemovals(answer.data.removals, gateSources);
  const row = await updateMatchSuggestions(
    match.id,
    { ...answer.data, actions: gate.actions, removals: cuts.removals },
    verification?.id ?? null,
  );
  logger.info(
    {
      matchId: match.id,
      jobId: match.jobId,
      resumeId: match.resumeId,
      actions: answer.data.actions.length,
      removals: answer.data.removals.length,
      replacementsBlocked: gate.blocked,
      replacementsWarned: gate.warned,
      removalsBlocked: cuts.blocked,
      removalsWarned: cuts.warned,
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
