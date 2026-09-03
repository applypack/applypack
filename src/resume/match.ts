import type { ResumeMatch } from '@prisma/client';
import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import {
  buildMatchPrompt,
  MATCH_FAST_MAX_TOKENS,
  MATCH_MAX_TOKENS,
  parseMatchResponse,
  PROMPT_VERSION,
  readKeywords,
  type MatchContext,
  type MatchJobInput,
} from './prompts';
import { annotateElsewhere, applyFacts } from './facts';
import { withTableAliases } from './keyword-aliases';
import { carryOverrides, effectiveKeywords } from './keyword-overrides';
import { anchorKeywords } from './keyword-anchor';
import { planKeywordFrame } from './keyword-frame';
import { loadKeywordMatcher } from './keyword-matcher';
import { readMatchMode, type MatchMode } from './match-mode';
import { readPromptVersion, reuseDecision } from './match-reuse';
import { scoreMatch } from './score';
import {
  createMatch,
  getLatestMatchForJob,
  getLatestMatchForResumeAndJob,
  listFacts,
  listOtherResumeSkills,
} from './store';

const PREVIOUS_KEYWORDS_MAX = 40;

const MATCH_TIMEOUT_MS = 5 * 60_000;
const PARSE_ATTEMPTS = 2;

/**
 * One resume-vs-posting comparison, persisted as a ResumeMatch row. `resume.text`
 * is what gets judged — a stored version, or an unsaved draft from the editor
 * (`draft: true`). Null on AI failure.
 *
 * One AI call; everything else is deterministic (ADR 0012): stored candidate
 * facts and other-resume skills go INTO the prompt, the reply's statuses are
 * reconciled against them in code, and score.ts computes the number.
 *
 * `mode` picks the prompt variant (ADR 0029): the quick check (default)
 * returns the score-complete subset, "full" also writes the suggestions.
 * `rebuild` throws away the keyword frame this posting has been carrying and
 * lets the model read the terms out of the description again (issue #79).
 */
export async function matchResumeToJob(
  resume: { id: number; text: string; version: number },
  job: MatchJobInput & { id: number },
  opts: { draft?: boolean; mode?: MatchMode; rebuild?: boolean } = {},
): Promise<ResumeMatch | null> {
  const mode = opts.mode ?? 'fast';
  const [facts, otherSkills, previousMatch, matcher] = await Promise.all([
    listFacts(),
    listOtherResumeSkills(resume.id),
    getLatestMatchForJob(job.id),
    loadKeywordMatcher(),
  ]);
  // The user's own edits to the last frame for this posting: the levels they
  // set go into the prompt, and carryOverrides puts every override back on the
  // fresh reply below, so an override sticks to the posting (§5) — including
  // when the frame itself is dropped.
  const storedKeywords = previousMatch ? readKeywords(previousMatch.keywords) : [];
  const frame = planKeywordFrame(
    previousMatch
      ? { terms: storedKeywords.length, promptVersion: readPromptVersion(previousMatch.breakdown) }
      : null,
    PROMPT_VERSION,
    opts.rebuild ?? false,
  );
  const context: MatchContext = {
    confirmedFacts: facts.filter((f) => f.status === 'confirmed').map((f) => ({ term: f.term, note: f.note })),
    deniedTerms: facts.filter((f) => f.status === 'denied').map((f) => f.term),
    otherResumeSkills: otherSkills,
    // The previous run's keyword frame keeps terms/levels stable across
    // versions, so a better resume shows up as a better number. Terms the user
    // ignored are left out of it — asking for them back would be noise.
    previousKeywords: frame.carry
      ? effectiveKeywords(storedKeywords)
          .slice(0, PREVIOUS_KEYWORDS_MAX)
          .map((k) => ({ term: k.term, priority: k.priority, requirement: k.requirement, primary: k.primary }))
      : undefined,
  };
  const prompt = buildMatchPrompt(resume.text, job, mode, context);
  const ai = await getAiRuntime();
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const started = Date.now();
    const out = await ai.complete({
      ...prompt,
      maxTokens: mode === 'fast' ? MATCH_FAST_MAX_TOKENS : MATCH_MAX_TOKENS,
      label: mode === 'fast' ? 'resume-match-fast' : 'resume-match',
      role: 'resume',
      timeoutMs: MATCH_TIMEOUT_MS,
    });
    if (out === null) return null;
    // The marker surfaces on the match card's meta line — the user can see
    // that a fallback engine (not chain #1) produced this analysis.
    const model = (out.model || out.providerId) + (out.viaFallback ? ' · fallback' : '');
    const parsed = parseMatchResponse(out.text);
    if (parsed.ok) {
      // Deterministic guarantees on top of the model's judgment: the alias
      // table joins the model's spellings, every term is anchored to the
      // posting (or flagged), stored facts always win, and unclaimable terms
      // point at the resume that has them.
      const posting = `${job.title}\n${job.description}`;
      const anchor = anchorKeywords(parsed.data.keywords.map(withTableAliases), posting, matcher);
      const carry = carryOverrides(anchor.keywords, storedKeywords, {
        resumeText: resume.text,
        posting,
        matcher,
      });
      const withFacts = applyFacts(carry.keywords, facts).keywords;
      const keywords = annotateElsewhere(withFacts, otherSkills);
      // The row stores what the user sees; the score reads what they decided:
      // their levels, without the terms they ignored (§5).
      const breakdown = scoreMatch(
        effectiveKeywords(keywords),
        parsed.data.alignment,
        parsed.data.red_flags.length,
      );
      const row = await createMatch({
        jobId: job.id,
        resumeId: resume.id,
        resumeVersion: resume.version,
        resumeText: resume.text,
        draft: opts.draft ?? false,
        model,
        result: { ...parsed.data, keywords },
        breakdown,
        promptVersion: PROMPT_VERSION,
        mode,
        frame: frame.reason,
      });
      logger.info(
        {
          matchId: row.id,
          jobId: job.id,
          resumeId: resume.id,
          version: resume.version,
          draft: row.draft,
          mode,
          score: row.matchScore,
          cap: breakdown.cap,
          keywords: keywords.length,
          anchored: anchor.anchored,
          unanchored: anchor.unanchored,
          overrides: carry.carried,
          readded: carry.readded,
          frame: frame.reason,
          promptVersion: PROMPT_VERSION,
          chars: out.text.length,
          ms: Date.now() - started,
        },
        'resume: matched',
      );
      return row;
    }
    logger.warn(
      { jobId: job.id, resumeId: resume.id, attempt, error: parsed.error, raw: out.text.slice(0, 500) },
      'resume: match reply did not match schema',
    );
  }
  return null;
}

/**
 * The stored comparison that already answers this request, or null. Callers
 * check it before starting a run so a repeat costs nothing (match-reuse.ts):
 * `reuse` shows the row as is, `suggest` means a full analysis was asked of a
 * quick check — only the suggestions call is missing.
 */
export async function findReusableMatch(
  jobId: number,
  resumeId: number,
  text: string,
  mode: MatchMode,
): Promise<{ row: ResumeMatch; decision: 'reuse' | 'suggest' } | null> {
  const previous = await getLatestMatchForResumeAndJob(jobId, resumeId);
  if (!previous) return null;
  const stored = {
    resumeText: previous.resumeText,
    promptVersion: readPromptVersion(previous.breakdown),
    mode: readMatchMode(previous.breakdown),
  };
  const decision = reuseDecision(stored, text, PROMPT_VERSION, mode);
  return decision === 'none' ? null : { row: previous, decision };
}
