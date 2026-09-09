import { config } from '../config';
import { logger } from '../logger';
import { createLimiter } from '../concurrency';
import { getAiRuntime, type AiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import { loadKeywordMatcher, type KeywordMatcher } from '../resume/keyword-matcher';
import { anchorScreenReply } from './anchor';
import { buildScreenPrompt, parseScreenResponse, SCREEN_MAX_TOKENS, SCREEN_PROMPT_VERSION, SCREEN_TIMEOUT_MS } from './prompts';
import { scoreScreening } from './score';
import type { Applicant } from '@prisma/client';
import { createVerdict, getScreening, listPending, listReadable, rubricOf, type ScreeningWithJob } from './store';
import type { Rubric } from './rubric';

/*
 * The batch (TASKS §19 stage 3): N independent calls under the limiter,
 * every verdict written the moment it arrives, so a restart resumes from
 * what is missing — `listPending` is the queue and the database is the
 * state. Only this in-memory map is lost with the web process, and it
 * holds nothing but the progress counter.
 *
 * The run DRAINS: when its batch is done it asks the queue again, so
 * applicants added while it was scoring are scored too — an upload starts
 * a run, and a second upload during it simply lengthens the same run.
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

export interface RunOptions {
  /** Score these applicants again, whatever verdicts they hold — the bulk "Score again". */
  again?: number[];
}

/**
 * Scores every readable applicant with no verdict under the current
 * rubric, then anyone added meanwhile. A second press while a run is in
 * flight joins it; a press after a rubric change scores everyone again,
 * because every stored verdict is about the old yardstick.
 */
export async function startScreeningRun(screeningId: number, opts: RunOptions = {}): Promise<StartOutcome> {
  const live = runs.get(screeningId);
  if (live?.running) return { kind: 'joined', state: live };
  // Claimed before the first await (the same guarantee target-runs.ts
  // relies on): a second POST landing while the queue is being read joins
  // this run instead of scoring everyone twice.
  const state: ScreenRunState = {
    screeningId,
    total: 0,
    done: 0,
    failed: 0,
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    lastError: null,
  };
  runs.set(screeningId, state);
  const screening = await getScreening(screeningId);
  const first = screening ? await queue(screening, opts.again) : [];
  if (!screening || first.length === 0) {
    runs.delete(screeningId);
    return screening ? { kind: 'nothing' } : { kind: 'missing' };
  }
  logger.info({ screeningId, applicants: first.length, again: opts.again?.length ?? 0, concurrency: config.AI_CONCURRENCY }, 'screening: run started');

  void (async () => {
    const [runtime, matcher] = await Promise.all([getAiRuntime(), loadKeywordMatcher()]);
    const limit = createLimiter(config.AI_CONCURRENCY);
    let batch = first;
    while (batch.length > 0) {
      state.total += batch.length;
      // The rubric is read per batch: a save mid-run is a new yardstick for
      // whoever is still in the queue, and their verdicts carry its version.
      const current = (await getScreening(screeningId)) ?? screening;
      const rubric = rubricOf(current);
      await Promise.all(
        batch.map((a) =>
          limit(async () => {
            const outcome = await screenApplicant(current, rubric, a, runtime, matcher);
            if (outcome.ok) state.done++;
            else {
              state.failed++;
              state.lastError = outcome.reason;
            }
          }),
        ),
      );
      batch = await queue(current);
    }
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

/** The next batch: the named applicants when asked to score them again, else whoever has no verdict under this rubric. */
async function queue(screening: ScreeningWithJob, again?: number[]): Promise<Pick<Applicant, 'id' | 'number' | 'redactedText'>[]> {
  const pending = await listPending(screening.id, screening.rubricVersion);
  if (!again || again.length === 0) return pending;
  const wanted = new Set(again);
  const named = await listReadable(screening.id, again);
  // Whoever is pending comes along — a "score again" should never leave a
  // never-scored applicant behind it.
  return [...named, ...pending.filter((p) => !wanted.has(p.id))];
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
