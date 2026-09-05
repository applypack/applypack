import type { CoverLetter } from '@prisma/client';
import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import {
  buildCoverPrompt,
  COVER_MAX_TOKENS,
  COVER_PROMPT_VERSION,
  COVER_WORDS_MAX,
  countWords,
  coverGateSources,
  parseCoverResponse,
  readKeywords,
  toPlainPunctuation,
  type CoverAngles,
  type CoverContext,
  type CoverTone,
  type MatchJobInput,
} from './prompts';
import { factCheck } from './fact-check';
import {
  createCoverLetter,
  getLatestCompanySnapshot,
  getLatestMatchForResumeAndJob,
  listFacts,
} from './store';

const COVER_TIMEOUT_MS = 3 * 60_000;
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
    // A quick-check row (ADR 0029) carries no strengths, so the shortlist is
    // then the verdict plus the evidenced keywords — thinner, never wrong.
    match: match ? distillMatch(match.summary, match.strengths, match.keywords) : undefined,
    companySnapshot,
  };
  const sources = coverGateSources(resume.text, job, companySnapshot);
  const ai = await getAiRuntime();

  let regenerated = false;
  let prompt = buildCoverPrompt(resume.text, job, context);
  for (;;) {
    const answer = await askForJson(
      ai,
      { ...prompt, maxTokens: COVER_MAX_TOKENS, label: 'cover-letter', role: 'cover', timeoutMs: COVER_TIMEOUT_MS },
      parseCoverResponse,
      { jobId: job.id },
    );
    if (!answer) return { kind: 'failed' };
    // Deterministic plain-punctuation pass BEFORE the gate, so what is
    // checked is exactly what gets stored and copied (F8.1).
    const letter = toPlainPunctuation(answer.data.letter);
    const gate = factCheck({
      text: letter,
      sources,
      facts,
      addressee: job.companyName,
    });
    const words = countWords(letter);
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
      text: letter,
      model: answer.model,
      promptVersion: COVER_PROMPT_VERSION,
      keywordsUsed: answer.data.keywords_used,
      gapsAcknowledged: answer.data.gaps_acknowledged,
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
