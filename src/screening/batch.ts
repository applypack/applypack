import type { Applicant } from '@prisma/client';
import { config } from '../config';
import { logger } from '../logger';
import { getAiRuntime, type AiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import { loadKeywordMatcher, type KeywordMatcher } from '../resume/keyword-matcher';
import { anchorScreenReply } from './anchor';
import { buildScreenPrompt, parseScreenResponse, SCREEN_MAX_TOKENS, SCREEN_PROMPT_VERSION, SCREEN_TIMEOUT_MS } from './prompts';
import { scoreScreening } from './score';
import { createVerdict, getScreening, listPending, listReadable, postingOf, rubricOf, screeningStamp, type ScreeningWithJob } from './store';
import type { Rubric } from './rubric';

/*
 * The batch (TASKS §19 stage 3): `AI_CONCURRENCY` workers pull applicants
 * off one queue and write every verdict the moment it arrives, so a
 * restart resumes from what is missing — `listPending` refills the queue
 * and the database is the state. Only this in-memory map is lost with the
 * web process, and it holds nothing but what the page shows: who is
 * queued, who is being read right now, how many are done.
 *
 * The queue is LIVE: an upload during a run refills it, and a "score again"
 * during a run joins it at the back instead of being refused — the person
 * pressed a button and sees the rows change state, never a "come back
 * later".
 *
 * Web-only: the worker never imports this (ADR 0008 / 0049).
 */

interface Queued {
  id: number;
  number: number;
  redactedText: string;
}

export interface ScreenRunState {
  screeningId: number;
  /** Everyone this run has taken on: done + failed + in flight + queued. */
  total: number;
  done: number;
  failed: number;
  running: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** Applicant numbers waiting, in order. */
  queued: number[];
  /** Applicant numbers a worker is reading right now. */
  inFlight: number[];
  /** Applicant numbers scored (or failed) since the page could last have shown them. */
  finished: number[];
  /** The last engine reason, for the page's error line. */
  lastError: string | null;
}

interface Run {
  state: ScreenRunState;
  queue: Queued[];
  /** Ids this run has taken on, so a refill never queues someone twice. */
  taken: Set<number>;
  /** Ids pushed by "score again" that must be read whatever verdict they hold. */
  again: Set<number>;
}

const runs = new Map<number, Run>();
const STATE_TTL_MS = 60 * 60_000;

/** What the page polls — never the queue itself. */
export function screeningRun(screeningId: number): ScreenRunState | null {
  const run = runs.get(screeningId);
  if (!run) return null;
  const s = run.state;
  if (!s.running && s.finishedAt !== null && Date.now() - s.finishedAt > STATE_TTL_MS) {
    runs.delete(screeningId);
    return null;
  }
  return s;
}

export type StartOutcome =
  | { kind: 'started'; state: ScreenRunState }
  /** A run was in flight; `queued` says how many this press added to it. */
  | { kind: 'joined'; state: ScreenRunState; queued: number }
  | { kind: 'nothing' }
  | { kind: 'missing' };

export interface RunOptions {
  /** Score these applicants again, whatever verdicts they hold — the bulk "Score again". */
  again?: number[];
}

/**
 * Scores every readable applicant with no verdict under the current
 * rubric, then anyone added meanwhile. A press during a run adds to its
 * queue; a press after a rubric change scores everyone again, because
 * every stored verdict is about the old yardstick.
 */
export async function startScreeningRun(screeningId: number, opts: RunOptions = {}): Promise<StartOutcome> {
  const live = runs.get(screeningId);
  if (live?.state.running) {
    const added = opts.again ? await enqueue(live, await listReadable(screeningId, opts.again), true) : 0;
    return { kind: 'joined', state: live.state, queued: added };
  }
  // Claimed before the first await (the same guarantee target-runs.ts
  // relies on): a second POST landing while the queue is being read joins
  // this run instead of scoring everyone twice.
  const run: Run = {
    state: {
      screeningId,
      total: 0,
      done: 0,
      failed: 0,
      running: true,
      startedAt: Date.now(),
      finishedAt: null,
      queued: [],
      inFlight: [],
      finished: [],
      lastError: null,
    },
    queue: [],
    taken: new Set(),
    again: new Set(),
  };
  runs.set(screeningId, run);
  const screening = await getScreening(screeningId);
  if (screening) {
    if (opts.again) await enqueue(run, await listReadable(screeningId, opts.again), true);
    await refill(run, screening);
  }
  if (!screening || run.queue.length === 0) {
    runs.delete(screeningId);
    return screening ? { kind: 'nothing' } : { kind: 'missing' };
  }
  logger.info({ screeningId, applicants: run.queue.length, again: opts.again?.length ?? 0, concurrency: config.AI_CONCURRENCY }, 'screening: run started');

  void (async () => {
    const [runtime, matcher] = await Promise.all([getAiRuntime(), loadKeywordMatcher()]);
    await Promise.all(Array.from({ length: config.AI_CONCURRENCY }, () => worker(run, screening, runtime, matcher)));
    run.state.running = false;
    run.state.finishedAt = Date.now();
    logger.info({ screeningId, done: run.state.done, failed: run.state.failed, ms: run.state.finishedAt - run.state.startedAt }, 'screening: run finished');
  })().catch((err) => {
    logger.error({ err, screeningId }, 'screening: run crashed');
    run.state.running = false;
    run.state.finishedAt = Date.now();
    run.state.lastError = 'Unexpected failure — see the web logs.';
  });

  return { kind: 'started', state: run.state };
}

/** Adds applicants to the back of the queue; a "score again" may re-add someone this run already read. */
async function enqueue(run: Run, rows: Queued[], again: boolean): Promise<number> {
  let added = 0;
  for (const row of rows) {
    if (run.queue.some((q) => q.id === row.id) || run.state.inFlight.includes(row.number)) continue;
    if (!again && run.taken.has(row.id)) continue;
    run.taken.add(row.id);
    if (again) run.again.add(row.id);
    run.queue.push(row);
    run.state.queued.push(row.number);
    run.state.total++;
    added++;
  }
  return added;
}

/** Whoever has no verdict under the current rubric and is not already this run's. */
async function refill(run: Run, screening: ScreeningWithJob): Promise<number> {
  const pending = await listPending(screening.id, screening.rubricVersion);
  return enqueue(
    run,
    pending.filter((p) => !run.taken.has(p.id)),
    false,
  );
}

/**
 * The screening as it stands, re-read only when its rubric version moved:
 * the whole row — posting text, rubric, job — used to be loaded twice per
 * applicant to compare one integer (DATA-4).
 */
async function freshIfChanged(screening: ScreeningWithJob): Promise<ScreeningWithJob> {
  const stamp = await screeningStamp(screening.id);
  if (!stamp || stamp.rubricVersion === screening.rubricVersion) return screening;
  return (await getScreening(screening.id)) ?? screening;
}

/** One worker: take the next applicant, score, repeat; refill from the database when the queue runs dry. */
async function worker(run: Run, screening: ScreeningWithJob, runtime: Pick<AiRuntime, 'complete'>, matcher: Pick<KeywordMatcher, 'findTerm' | 'locateQuote'>): Promise<void> {
  for (;;) {
    let next = run.queue.shift();
    if (!next) {
      // The rubric may have been saved mid-run: the queue is read against the current version.
      const current = await freshIfChanged(screening);
      if ((await refill(run, current)) === 0) return;
      next = run.queue.shift();
      if (!next) return;
      screening = current;
    }
    run.state.queued = run.state.queued.filter((n) => n !== next!.number);
    run.state.inFlight.push(next.number);
    const current = await freshIfChanged(screening);
    screening = current;
    const outcome = await screenApplicant(current, rubricOf(current), next, runtime, matcher);
    run.state.inFlight = run.state.inFlight.filter((n) => n !== next!.number);
    run.state.finished.push(next.number);
    run.again.delete(next.id);
    if (outcome.ok) run.state.done++;
    else {
      run.state.failed++;
      run.state.lastError = outcome.reason;
    }
  }
}

/**
 * One applicant, one call: prompt → reply → the anchor guard → the score →
 * a verdict row. Never throws — a failure is a counted reason, and the
 * applicant stays pending for the next run.
 */
async function screenApplicant(
  screening: ScreeningWithJob,
  rubric: Rubric,
  applicant: Pick<Applicant, 'id' | 'number' | 'redactedText'>,
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
          job: postingOf(screening),
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
