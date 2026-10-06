import { logger } from './logger';
import { preferWebTools, type AiProviderId, type ResolvedAiEngine } from './ai-engine';
import { taskOf } from './ai-tasks';
import type { CooldownTracker } from './ai-cooldown';
import type { AiProvider } from './ai-provider';
import type { AiCallRequest, AiCallResult } from './ai-runtime';
import type { LedgerInput } from './ai-spend';
import type { AiBilling } from './ai-usage';
import { hashShortId } from './text-utils';

/*
 * One logical AI call run down the engine chain (ADR 0013/0014) — the engines
 * that take the call's task (ADR 0060): the first engine that answers wins,
 * every attempt goes in the ledger (ADR 0055), a failing engine cools down
 * and a refused credential is left alone until it changes (H40). Its I/O is
 * injected — the backends, the ledger, the clock — so the loop itself is
 * tested (H45); ai-runtime.ts hands it the real ones.
 */

// Chain guards (docs/ai-engine-improvements.md item 2): at most this many
// engines per logical call, inside a deadline of FACTOR × the per-attempt
// timeout — a 3-CLI verify chain must not become a 30-minute wait.
const MAX_ENGINE_SWITCHES = 3;
const CHAIN_DEADLINE_FACTOR = 2;
const MIN_REMAINING_MS = 5_000;
// Mirrors the provider-internal CLI default timeout.
const DEFAULT_ATTEMPT_TIMEOUT_MS = 180_000;
/**
 * A model on this machine answers in minutes where a hosted one takes
 * seconds, and waits its turn behind the calls before it (ADR 0057): its
 * attempt gets this much more of the clock, and the chain's deadline grows
 * with it so the engine behind still has its own.
 */
const ENGINE_TIME_FACTOR: Partial<Record<AiProviderId, number>> = { local_api: 3 };
const timeFactor = (id: AiProviderId): number => ENGINE_TIME_FACTOR[id] ?? 1;

export interface ChainContext {
  /** The credential each engine calls with (ai-keys.ts), undefined for a sign-in the CLI keeps itself. */
  keyFor(id: AiProviderId): string | undefined;
  /** Where the OpenAI-compatible engine sends its calls (ai-runtime.ts:openAiBase). */
  openAiBase: string;
  /** The local engine's Ollama root and the context window it asks for (ADR 0057). */
  localBase: string;
  localContextTokens: number;
  billingOf(id: AiProviderId): AiBilling;
}

export interface ChainDeps {
  /** The backend for an engine; throws when it cannot be built on this host. */
  providerFor(id: AiProviderId): AiProvider;
  /** One ledger row per attempt; never throws (ai-ledger.ts:recordAiCall). */
  record(row: LedgerInput): Promise<void>;
  cooldowns: CooldownTracker;
  now(): number;
}

export async function runChain(
  engine: ResolvedAiEngine,
  req: AiCallRequest,
  ctx: ChainContext,
  deps: ChainDeps,
): Promise<AiCallResult | null> {
  // A fingerprint, never the key: a refusal is lifted by a different one.
  const credential = (id: AiProviderId) => hashShortId(ctx.keyFor(id) ?? '');
  const takers = engine.chainFor(taskOf(req.label));
  // Verification asks for web tools — prefer engines that have them, but a
  // tool-less engine is still better than no answer at all.
  const chain = req.webTools ? preferWebTools(takers) : takers;
  // Engines in cooldown are skipped — unless that would leave nothing to try.
  const hot = chain.filter((id) => deps.cooldowns.blockedUntil(id, credential(id)) === null);
  if (hot.length > 0 && hot.length < chain.length) {
    logger.debug({ cooling: chain.filter((id) => !hot.includes(id)), label: req.label }, 'ai: engines in cooldown, skipped');
  }
  const tryList = (hot.length > 0 ? hot : chain).slice(0, MAX_ENGINE_SWITCHES);
  const perAttemptMs = req.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const deadline = deps.now() + perAttemptMs * CHAIN_DEADLINE_FACTOR * Math.max(1, ...tryList.map(timeFactor));
  for (let i = 0; i < tryList.length; i++) {
    const id = tryList[i]!;
    const remainingMs = deadline - deps.now();
    if (i > 0 && remainingMs < MIN_REMAINING_MS) {
      logger.warn({ tried: tryList.slice(0, i), label: req.label }, 'ai: chain deadline reached');
      break;
    }
    let provider: AiProvider;
    try {
      provider = deps.providerFor(id);
    } catch (err) {
      logger.warn({ err, provider: id }, 'ai: engine not constructible, skipping');
      continue;
    }
    const model = engine.modelFor(id, req.role);
    const started = deps.now();
    const attempt = await provider.complete({
      system: req.system,
      user: req.user,
      maxTokens: req.maxTokens,
      label: req.label,
      model,
      timeoutMs: Math.min(perAttemptMs * timeFactor(id), remainingMs),
      webTools: req.webTools,
      json: req.json,
      apiKey: ctx.keyFor(id),
      ...(id === 'openai_api' && { baseUrl: ctx.openAiBase }),
      ...(id === 'local_api' && { baseUrl: ctx.localBase, contextTokens: ctx.localContextTokens }),
      onError: req.onError,
    });
    const viaFallback = id !== chain[0];
    // Every attempt, the failed ones too: a cut-off reply was billed (ADR 0055).
    await deps.record({
      at: new Date(started),
      durationMs: deps.now() - started,
      engine: id,
      model,
      feature: req.label,
      outcome: attempt.outcome,
      spend: attempt.spend,
      viaFallback,
      billing: ctx.billingOf(id),
      jobId: req.subject?.jobId,
      resumeId: req.subject?.resumeId,
    });
    if (attempt.text !== null) {
      deps.cooldowns.success(id);
      if (viaFallback) logger.warn({ served: id, primary: chain[0], label: req.label }, 'ai: served by fallback engine');
      return { text: attempt.text, providerId: id, model, viaFallback };
    }
    if (attempt.outcome === 'unauthorized') deps.cooldowns.refused(id, credential(id));
    else deps.cooldowns.failure(id);
    if (i < tryList.length - 1) {
      logger.warn({ failed: id, next: tryList[i + 1], label: req.label }, 'ai: engine failed, trying next');
    }
  }
  logger.error({ chain: tryList, label: req.label }, 'ai: every engine in the chain failed');
  return null;
}
