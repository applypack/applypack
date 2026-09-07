import type { ResumeMatch } from '@prisma/client';
import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import { briefForPosting } from './brief';
import { loadKeywordMatcher } from './keyword-matcher';
import {
  buildRewritePrompt,
  parseRewriteResponse,
  readActions,
  readKeywords,
  RESUME_TIMEOUT_MS,
  REWRITE_MAX_TOKENS,
  type MatchJobInput,
} from './prompts';
import { gateActions } from './replacement-gate';
import { listFacts, updateMatchActions } from './store';

/*
 * "Rewrite" on one suggestion card. Everything the comparison decided stays
 * decided — which keyword the edit serves, which line it points at, whether
 * the resume can support it — and only the sentence is written again. The new
 * wording goes through the same gate as the old one (ADR 0037), so a rewrite
 * cannot slip past a rule the first wording obeyed.
 *
 * Null when the model fails or the index names no action. A blocked wording is
 * NOT null: it is stored with its reason on `why`, exactly as the first pass
 * would have stored it, so the user can see why their rewrite was refused.
 */
export async function rewriteAction(
  match: ResumeMatch,
  job: MatchJobInput & { id: number },
  index: number,
  onError?: (reason: string) => void,
): Promise<ResumeMatch | null> {
  const actions = readActions(match.actions);
  const action = actions[index];
  if (!action) return null;

  const keywords = readKeywords(match.keywords);
  const [facts, briefed] = await Promise.all([listFacts(), briefForPosting(job)]);
  const answer = await askForJson(
    await getAiRuntime(),
    {
      ...buildRewritePrompt(match.resumeText, job, {
        action,
        keywords,
        confirmedFacts: facts.filter((f) => f.status === 'confirmed').map((f) => ({ term: f.term, note: f.note })),
        deniedTerms: facts.filter((f) => f.status === 'denied').map((f) => f.term),
        brief: briefed?.brief ?? null,
      }),
      maxTokens: REWRITE_MAX_TOKENS,
      label: 'resume-rewrite',
      role: 'resume',
      timeoutMs: RESUME_TIMEOUT_MS.rewrite,
      onError,
    },
    parseRewriteResponse,
    { matchId: match.id },
  );
  if (!answer) return null;

  // The target is the comparison's, not the model's: only the three written
  // fields are taken, so a reply that wandered to another line cannot move it.
  const rewritten = { ...action, what: answer.data.what, why: answer.data.why, replacement: answer.data.replacement };
  const gate = gateActions([rewritten], {
    resumeText: match.resumeText,
    posting: `${job.title}\n${job.description}`,
    facts,
    keywords,
    matcher: await loadKeywordMatcher(),
  });
  const next = actions.map((a, i) => (i === index ? gate.actions[0] ?? a : a));
  const row = await updateMatchActions(match.id, next);
  logger.info(
    {
      matchId: match.id,
      jobId: match.jobId,
      index,
      section: action.section,
      blocked: gate.blocked,
      warned: gate.warned,
      model: answer.model,
      ms: answer.ms,
    },
    'resume: suggestion rewritten',
  );
  return row;
}
