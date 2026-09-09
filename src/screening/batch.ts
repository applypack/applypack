import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { getAiRuntime, type AiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import { loadKeywordMatcher, type KeywordMatcher } from '../resume/keyword-matcher';
import { anchorScreenReply } from './anchor';
import { buildScreenPrompt, parseScreenResponse, SCREEN_MAX_TOKENS, SCREEN_PROMPT_VERSION, SCREEN_TIMEOUT_MS } from './prompts';
import { scoreScreening } from './score';
import { createVerdict, getScreening, listPending, rubricOf, type ScreeningWithJob } from './store';
import type { Rubric } from './rubric';

/*
 * The batch (TASKS §19 stage 3): N independent calls under the limiter,
 * every verdict written the moment it arrives, so a restart resumes from
 * what is missing — `listPending` is the queue and the database is the
 * state. Only this in-memory map is lost with the web process, and it
 * holds nothing but the progress counter.
 *
 * Web-only: the worker never imports this (ADR 0008 / 0049).
 */

export interface ScreenRunState {
  screeningId: number;
  total: number;
  done: number;
  failed: number;
  running: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** The last engine reason, for the page's error line. */
  lastError: string | null;
}

const runs = new Map<number, ScreenRunState>();
const STATE_TTL_MS = 60 * 60_000;

export function screeningRun(screeningId: number): ScreenRunState | null {
  const state = runs.get(screeningId);
  if (state && !state.running && state.finishedAt !== null && Date.now() - state.finishedAt > STATE_TTL_MS) {
    runs.delete(screeningId);
    return null;
  }
  return state ?? null;
}

export type StartOutcome =
  | { kind: 'started'; state: ScreenRunState }
  | { kind: 'joined'; state: ScreenRunState }
  | { kind: 'nothing' }
  | { kind: 'missing' };

/**
 * Scores every readable applicant with no verdict under the current
 * rubric. A second press while a run is in flight joins it; a press after
 * a rubric change scores everyone again, because every stored verdict is
 * about the old yardstick.
 */
export async function startScreeningRun(screeningId: number): Promise<StartOutcome> {
  const live = runs.get(screeningId);
  if (live?.running) return { kind: 'joined', state: live };
  const screening = await getScreening(screeningId);
  if (!screening) return { kind: 'missing' };
  const pending = await listPending(screeningId, screening.rubricVersion);
  if (pending.length === 0) return { kind: 'nothing' };

  const state: ScreenRunState = {
    screeningId,
    total: pending.length,
    done: 0,
    failed: 0,
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    lastError: null,
  };
  runs.set(screeningId, state);
  logger.info({ screeningId, applicants: pending.length, concurrency: config.AI_CONCURRENCY }, 'screening: run started');

  void (async () => {
    const [runtime, matcher] = await Promise.all([getAiRuntime(), loadKeywordMatcher()]);
    const rubric = rubricOf(screening);
    const limit = createLimiter(config.AI_CONCURRENCY);
    await Promise.all(
      pending.map((a) =>
        limit(async () => {
          const outcome = await screenApplicant(screening, rubric, a, runtime, matcher);
          if (outcome.ok) state.done++;
          else {
            state.failed++;
            state.lastError = outcome.reason;
          }
        }),
      ),
    );
    state.running = false;
    state.finishedAt = Date.now();
    logger.info(
      { screeningId, done: state.done, failed: state.failed, ms: state.finishedAt - state.startedAt },
      'screening: run finished',
    );
  })().catch((err) => {
    logger.error({ err, screeningId }, 'screening: run crashed');
    state.running = false;
    state.finishedAt = Date.now();
    state.lastError = 'Unexpected failure — see the web logs.';
  });

  return { kind: 'started', state };
}

/**
 * One applicant, one call: prompt → reply → the anchor guard → the score →
 * a verdict row. Never throws — a failure is a counted reason, and the
 * applicant stays pending for the next run.
 */
export async function screenApplicant(
  screening: ScreeningWithJob,
  rubric: Rubric,
  applicant: { id: number; number: number; redactedText: string },
  runtime: Pick<AiRuntime, 'complete'>,
  matcher: Pick<KeywordMatcher, 'findTerm' | 'locateQuote'>,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let reason = '';
  try {
    const answer = await askForJson(
      runtime,
      {
        ...buildScreenPrompt({
          rubric,
          job: {
            title: screening.job.title,
            companyName: screening.job.company.name,
            location: screening.job.location,
            description: screening.job.description,
          },
          applicantText: applicant.redactedText,
          number: applicant.number,
        }),
        maxTokens: SCREEN_MAX_TOKENS,
        label: 'screening',
        role: 'resume',
        timeoutMs: SCREEN_TIMEOUT_MS,
        onError: (r) => {
          reason = r;
        },
      },
      parseScreenResponse,
      { screeningId: screening.id, applicantId: applicant.id },
    );
    if (!answer) return { ok: false, reason: reason || 'no engine answered' };

    const anchored = anchorScreenReply(answer.data, applicant.redactedText, rubric, matcher);
    const breakdown = scoreScreening({ rubric, reply: anchored.reply, textChars: applicant.redactedText.length, now });
    await createVerdict({
      applicantId: applicant.id,
      rubricVersion: screening.rubricVersion,
      promptVersion: SCREEN_PROMPT_VERSION,
      model: answer.model,
      facts: anchored.reply,
      breakdown,
      score: breakdown.score,
      confidence: breakdown.confidence.band,
      gateBucket: breakdown.gateBucket,
    });
    logger.info(
      {
        screeningId: screening.id,
        applicantId: applicant.id,
        number: applicant.number,
        score: breakdown.score,
        cap: breakdown.cap,
        bucket: breakdown.gateBucket,
        confidence: breakdown.confidence.band,
        injection: anchored.reply.injection,
        ...anchored.report,
        model: answer.model,
        chars: answer.chars,
        ms: answer.ms,
      },
      'screening: applicant scored',
    );
    return { ok: true };
  } catch (err) {
    logger.error({ err, screeningId: screening.id, applicantId: applicant.id }, 'screening: applicant failed');
    return { ok: false, reason: reason || (err instanceof Error ? err.message : 'unexpected failure') };
  }
}
