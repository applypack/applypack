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
  type MatchSuggestions,
} from './prompts';
import { readBreakdown } from './score';
import { loadKeywordMatcher } from './keyword-matcher';
import { gateActions } from './replacement-gate';
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
    // Every array defaults to empty, so "{}" parses — but a reply with nothing
    // in it would flip the row to "full" and lock the button out for good.
    if (parsed.ok && !isEmpty(parsed.data)) {
      // The same gate the full report runs before it stores (ADR 0037).
      const gate = gateActions(parsed.data.actions, {
        resumeText: match.resumeText,
        posting: `${job.title}\n${job.description}`,
        facts,
        keywords: readKeywords(match.keywords),
        matcher: await loadKeywordMatcher(),
      });
      const row = await updateMatchSuggestions(match.id, { ...parsed.data, actions: gate.actions });
      logger.info(
        {
          matchId: match.id,
          jobId: match.jobId,
          resumeId: match.resumeId,
          actions: parsed.data.actions.length,
          removals: parsed.data.removals.length,
          replacementsBlocked: gate.blocked,
          replacementsWarned: gate.warned,
          model: out.model || out.providerId,
          chars: out.text.length,
          ms: Date.now() - started,
        },
        'resume: suggestions added',
      );
      return row;
    }
    logger.warn(
      { matchId: match.id, attempt, error: parsed.ok ? 'empty reply' : parsed.error, raw: out.text.slice(0, 500) },
      'resume: suggestions reply unusable',
    );
  }
  return null;
}

function isEmpty(s: MatchSuggestions): boolean {
  return s.actions.length + s.removals.length + s.strengths.length + s.cautions.length === 0;
}
