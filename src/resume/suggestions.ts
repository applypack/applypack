import type { ResumeMatch } from '@prisma/client';
import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import {
  buildSuggestionsPrompt,
  parseSuggestionsResponse,
  readActions,
  readHardRequirements,
  readKeywords,
  SUGGESTIONS_MAX_TOKENS,
  type MatchJobInput,
  type MatchSuggestions,
  RESUME_TIMEOUT_MS,
} from './prompts';
import { briefForPosting } from './brief';
import { readBreakdown } from './score';
import { loadKeywordMatcher } from './keyword-matcher';
import { gateActions, gateRemovals } from './replacement-gate';
import { appliedWording, freshActions, rewritesOfApplied } from './applied';
import { domainMismatch } from './domain';
import { getLatestMatchForJob, getLatestVerificationContext, getResumeIndustries, listFacts, updateMatchSuggestions } from './store';


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
  /** What a first reply owed and did not deliver (suggestion-floor.ts). */
  owed?: string | null,
): Promise<ResumeMatch | null> {
  const [facts, verification, briefed, previous, matcher, industries] = await Promise.all([
    listFacts(),
    getLatestVerificationContext(job.id),
    // Written by the comparison this row came from, so this is normally a
    // stored read: who this employer is and what its first reader scans for.
    briefForPosting(job),
    // The report before this row: what it proposed and the text took is done (applied.ts).
    getLatestMatchForJob(job.id, match.id),
    loadKeywordMatcher(),
    getResumeIndustries(match.resumeId),
  ]);
  const applied = previous ? appliedWording(readActions(previous.actions), match.resumeText, matcher.locateQuote) : [];
  const prompt = buildSuggestionsPrompt(match.resumeText, job, {
    owed: owed ?? null,
    summary: match.summary,
    alignment: readBreakdown(match.breakdown)?.alignment ?? null,
    // Carries `evidence` (evidence.ts) — the "listed only" gap the floor asks about.
    keywords: readKeywords(match.keywords),
    hardRequirements: readHardRequirements(match.hardRequirements),
    confirmedFacts: facts.filter((f) => f.status === 'confirmed').map((f) => ({ term: f.term, note: f.note })),
    deniedTerms: facts.filter((f) => f.status === 'denied').map((f) => f.term),
    // Context for the "why" lines, never evidence (ADR 0042).
    companySnapshot: verification?.snapshot ?? null,
    brief: briefed?.brief ?? null,
    appliedFromLastRun: applied.map((a) => a.wording),
    candidateDomains: domainMismatch(industries, briefed?.brief),
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
    // Carries `evidence` (evidence.ts) — the "listed only" gap the floor asks about.
    keywords: readKeywords(match.keywords),
    matcher,
  };
  const gate = gateActions(answer.data.actions, gateSources);
  const cuts = gateRemovals(answer.data.removals, gateSources);
  const churn = rewritesOfApplied(applied, gate.actions, match.resumeText, matcher.locateQuote);
  const fresh = freshActions(gate.actions, applied, gateSources.keywords, match.resumeText, matcher);
  const row = await updateMatchSuggestions(
    match.id,
    { ...answer.data, actions: fresh.kept, removals: cuts.removals },
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
      applied: applied.length,
      rewritesOfApplied: churn.length,
      reworksDropped: fresh.dropped.length,
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
