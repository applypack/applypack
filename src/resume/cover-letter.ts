import type { CoverLetter } from '@prisma/client';
import { logger } from '../logger';
import { getAiRuntime, type AiRuntime } from '../ai-runtime';
import {
  buildCoverPrompt,
  COVER_MAX_TOKENS,
  COVER_PROMPT_VERSION,
  COVER_WORDS_MAX,
  countWords,
  coverGateSources,
  parseCoverResponse,
  readKeywords,
  type CoverAngles,
  type CoverContext,
  type CoverResult,
  type CoverTone,
  type MatchJobInput,
  type Prompt,
} from './prompts';
import { factCheck } from './fact-check';
import {
  createCoverLetter,
  getLatestCompanySnapshot,
  getLatestMatchForResumeAndJob,
  listFacts,
} from './store';

const COVER_TIMEOUT_MS = 3 * 60_000;
const PARSE_ATTEMPTS = 2;
const MATCH_ALIGNED_MAX = 12;
const MATCH_GAPS_MAX = 6;

export type CoverOutcome =
  | { kind: 'ok'; row: CoverLetter }
  /** The gate fired twice — nothing was shown, nothing was persisted (ADR 0021). */
  | { kind: 'blocked'; reasons: string[] }
  | { kind: 'failed' };

/**
 * One grounded cover letter, persisted as a CoverLetter row. Mirrors
 * match.ts: prompts.ts builds and parses, this file talks to the AI
 * provider, store.ts owns Prisma. Tool-free by construction — no webTools,
 * ever (ADR 0009). The fact gate (ADR 0020) runs between generation and
 * persistence: block → one regeneration with the reasons quoted → still
 * block → refuse.
 */
export async function generateCoverLetter(
  resume: { id: number; text: string; version: number },
  job: MatchJobInput & { id: number },
  opts: { tone: CoverTone; angles?: CoverAngles },
): Promise<CoverOutcome> {
  const started = Date.now();
  const [facts, match, companySnapshot] = await Promise.all([
    listFacts(),
    getLatestMatchForResumeAndJob(job.id, resume.id),
    getLatestCompanySnapshot(job.id),
  ]);
  const context: CoverContext = {
    tone: opts.tone,
    angles: opts.angles,
    confirmedFacts: facts
      .filter((f) => f.status === 'confirmed')
      .map((f) => ({ term: f.term, note: f.note })),
    deniedTerms: facts.filter((f) => f.status === 'denied').map((f) => f.term),
    match: match ? distillMatch(match.summary, match.strengths, match.keywords) : undefined,
    companySnapshot,
  };
  const sources = coverGateSources(resume.text, job, companySnapshot);
  const ai = await getAiRuntime();

  let regenerated = false;
  let prompt = buildCoverPrompt(resume.text, job, context);
  for (;;) {
    const answer = await askOnce(ai, prompt, job.id);
    if (!answer) return { kind: 'failed' };
    const gate = factCheck({
      text: answer.parsed.letter,
      sources,
      facts,
      addressee: job.companyName,
    });
    const words = countWords(answer.parsed.letter);
    const violations = [
      ...(gate.verdict === 'block' ? gate.reasons : []),
      ...(words > COVER_WORDS_MAX
        ? [`the letter runs ${words} words — the cap is ${COVER_WORDS_MAX}`]
        : []),
    ];
    if (violations.length > 0 && !regenerated) {
      logger.info({ jobId: job.id, resumeId: resume.id, violations }, 'cover: regenerating once');
      regenerated = true;
      prompt = buildCoverPrompt(resume.text, job, { ...context, violations });
      continue;
    }
    if (gate.verdict === 'block') {
      logger.warn({ jobId: job.id, resumeId: resume.id, reasons: gate.reasons }, 'cover: blocked twice, refused');
      return { kind: 'blocked', reasons: gate.reasons };
    }
    // Length overflow after the retry is imprecision, not fabrication — keep
    // the letter and say so (ADR 0020's verdict semantics stay the gate's).
    const notes = [
      ...(regenerated ? ['accepted after one regeneration'] : []),
      ...gate.reasons,
      ...(words > COVER_WORDS_MAX ? [`runs ${words} words — target is ${COVER_WORDS_MAX}`] : []),
    ];
    const row = await createCoverLetter({
      jobId: job.id,
      resumeId: resume.id,
      resumeVersion: resume.version,
      tone: opts.tone,
      text: answer.parsed.letter,
      model: answer.model,
      promptVersion: COVER_PROMPT_VERSION,
      keywordsUsed: answer.parsed.keywords_used,
      gapsAcknowledged: answer.parsed.gaps_acknowledged,
      usedVerification: companySnapshot !== null,
      gateVerdict: gate.verdict,
      gateNotes: notes,
    });
    logger.info(
      {
        letterId: row.id,
        jobId: job.id,
        resumeId: resume.id,
        words,
        verdict: gate.verdict,
        regenerated,
        promptVersion: COVER_PROMPT_VERSION,
        ms: Date.now() - started,
      },
      'cover: generated',
    );
    return { kind: 'ok', row };
  }
}

/** One provider call with the match.ts parse-retry pattern. */
async function askOnce(
  ai: AiRuntime,
  prompt: Prompt,
  jobId: number,
): Promise<{ parsed: CoverResult; model: string } | null> {
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const out = await ai.complete({
      ...prompt,
      maxTokens: COVER_MAX_TOKENS,
      label: 'cover-letter',
      role: 'resume',
      timeoutMs: COVER_TIMEOUT_MS,
    });
    if (out === null) return null;
    const parsed = parseCoverResponse(out.text);
    if (parsed.ok) {
      // Same marker as the match card: the user sees when a fallback engine
      // (not chain #1) wrote this letter.
      return { parsed: parsed.data, model: (out.model || out.providerId) + (out.viaFallback ? ' · fallback' : '') };
    }
    logger.warn(
      { jobId, attempt, error: parsed.error, raw: out.text.slice(0, 300) },
      'cover: reply did not match schema',
    );
  }
  return null;
}

/** The match row boiled down to what a letter needs: what to feature, what to concede. */
function distillMatch(
  summary: string,
  strengths: string[],
  keywordsJson: unknown,
): NonNullable<CoverContext['match']> {
  const keywords = readKeywords(keywordsJson);
  return {
    summary,
    strengths,
    aligned: keywords
      .filter((k) => k.status === 'present')
      .slice(0, MATCH_ALIGNED_MAX)
      .map((k) => ({ term: k.term, where: k.where })),
    // "add" is claimable evidence, not a gap; unanswered ask_user is a gap here.
    gaps: keywords
      .filter(
        (k) =>
          (k.status === 'cannot_claim' || k.status === 'ask_user') &&
          (k.requirement === 'must' || k.requirement === 'preferred'),
      )
      .slice(0, MATCH_GAPS_MAX)
      .map((k) => k.term),
  };
}
