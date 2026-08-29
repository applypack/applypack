import type { ResumeMatch } from '@prisma/client';
import { config } from '../config';
import { logger } from '../logger';
import { getAiProvider } from '../ai-provider';
import {
  buildMatchPrompt,
  MATCH_MAX_TOKENS,
  parseMatchResponse,
  PROMPT_VERSION,
  readKeywords,
  type MatchContext,
  type MatchJobInput,
} from './prompts';
import { annotateElsewhere, applyFacts } from './facts';
import { scoreMatch } from './score';
import { createMatch, getLatestMatchForJob, listFacts, listOtherResumeSkills } from './store';

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
 */
export async function matchResumeToJob(
  resume: { id: number; text: string; version: number },
  job: MatchJobInput & { id: number },
  opts: { draft?: boolean } = {},
): Promise<ResumeMatch | null> {
  const [facts, otherSkills, previousMatch] = await Promise.all([
    listFacts(),
    listOtherResumeSkills(resume.id),
    getLatestMatchForJob(job.id),
  ]);
  const context: MatchContext = {
    confirmedFacts: facts.filter((f) => f.status === 'confirmed').map((f) => ({ term: f.term, note: f.note })),
    deniedTerms: facts.filter((f) => f.status === 'denied').map((f) => f.term),
    otherResumeSkills: otherSkills,
    // The previous run's keyword frame keeps terms/levels stable across
    // versions, so a better resume shows up as a better number.
    previousKeywords: previousMatch
      ? readKeywords(previousMatch.keywords)
          .slice(0, PREVIOUS_KEYWORDS_MAX)
          .map((k) => ({ term: k.term, priority: k.priority, requirement: k.requirement, primary: k.primary }))
      : undefined,
  };
  const prompt = buildMatchPrompt(resume.text, job, context);
  const provider = getAiProvider();
  const model = config.CLAUDE_MODEL_RESUME;
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const started = Date.now();
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
      // Deterministic guarantees on top of the model's judgment: stored facts
      // always win, and unclaimable terms point at the resume that has them.
      const withFacts = applyFacts(parsed.data.keywords, facts).keywords;
      const keywords = annotateElsewhere(withFacts, otherSkills);
      const breakdown = scoreMatch(keywords, parsed.data.alignment, parsed.data.red_flags.length);
      const row = await createMatch({
        jobId: job.id,
        resumeId: resume.id,
        resumeVersion: resume.version,
        resumeText: resume.text,
        draft: opts.draft ?? false,
        model,
        result: { ...parsed.data, keywords },
        breakdown,
      });
      logger.info(
        {
          matchId: row.id,
          jobId: job.id,
          resumeId: resume.id,
          version: resume.version,
          draft: row.draft,
          score: row.matchScore,
          cap: breakdown.cap,
          promptVersion: PROMPT_VERSION,
          ms: Date.now() - started,
        },
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
