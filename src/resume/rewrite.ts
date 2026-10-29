import type { ResumeMatch } from '@prisma/client';
import { readMatchEvidence } from './match-mode';
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
  type MatchAction,
  type MatchJobInput,
} from './prompts';
import { gateActions, splitRefusal } from './replacement-gate';
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
  // A refused wording comes back with its reason as its own line, not as the tail of "why".
  const { why, refusal } = splitRefusal(action);
  // A comparison judged on its text alone keeps its rewrites to it too (TASKS R1).
  const [facts, briefed] = await Promise.all([
    readMatchEvidence(match.breakdown) === 'own' ? listFacts() : [],
    briefForPosting(job),
  ]);
  const answer = await askForJson(
    await getAiRuntime(),
    {
      ...buildRewritePrompt(match.resumeText, job, {
        action: { ...action, why },
        refusal,
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
      subject: { jobId: job.id, resumeId: match.resumeId },
    },
    parseRewriteResponse,
    { matchId: match.id },
  );
  if (!answer) return null;

  // The target is the comparison's, not the model's: only the three written
  // fields are taken, so a reply that wandered to another line cannot move it.
  const rewritten = { ...action, what: answer.data.what, why: answer.data.why, replacement: answer.data.replacement };
  // The rest of the report stays as it is: a term another card already writes in is taken (#633).
  const gate = gateActions(
    [rewritten],
    { resumeText: match.resumeText, posting: `${job.title}\n${job.description}`, facts, keywords, matcher: await loadKeywordMatcher() },
    { alongside: actions.filter((_, i) => i !== index) },
  );
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

/** What REQUIRED COVERAGE owes a complete wording (suggestion-floor.ts) — the two lines read first. */
const OWED_WORDING: ReadonlySet<MatchAction['section']> = new Set(['title', 'summary']);

/**
 * The gate refuses a wording whole, and on the title or the summary that left
 * the edit that matters most with nothing to apply: the live case mirrored the
 * posting's "PHP and/or Java" into a PHP resume's summary, and the card said
 * only "Rewrite summary to lead with PHP/Symfony". So each refused lead gets
 * one more call with the reason in sight; the new wording passes the same gate,
 * and a second refusal stays on the card for the user's own Rewrite.
 */
export async function rewriteRefusedLeads(match: ResumeMatch, job: MatchJobInput & { id: number }): Promise<ResumeMatch> {
  const refused = readActions(match.actions).flatMap((a, index) =>
    OWED_WORDING.has(a.section) && splitRefusal(a).refusal !== null ? [index] : [],
  );
  let row = match;
  // One at a time: each call stores the whole action list it was given.
  for (const index of refused) row = (await rewriteAction(row, job, index)) ?? row;
  if (refused.length > 0) {
    const still = readActions(row.actions).filter((a) => OWED_WORDING.has(a.section) && splitRefusal(a).refusal !== null);
    logger.info({ matchId: match.id, jobId: match.jobId, refused: refused.length, stillRefused: still.length }, 'resume: refused lead wording written again');
  }
  return row;
}
