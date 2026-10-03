import Anthropic from '@anthropic-ai/sdk';
import { execFile, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { config } from './config';
import { logger } from './logger';
import { sleep } from './http';
import { addUsage, isLocalUrl, NO_USAGE, type AiOutcome, type AiSpend } from './ai-usage';
import {
  anthropicMaxTokens,
  anthropicUsage,
  buildClaudeCodeArgs,
  buildOllamaChatBody,
  DEFAULT_LOCAL_CONTEXT_TOKENS,
  localBudgetTokens,
  ollamaError,
  parseOllamaStream,
  buildCliEnv,
  buildCodexCliArgs,
  buildGeminiCliArgs,
  buildAgyCliArgs,
  CLAUDE_CODE_ISOLATION_ENV,
  CLI_PROVIDER_ENV_KEYS,
  cliRetryable,
  cliThinkingCap,
  cliFailure,
  describeAiFailure,
  failureKind,
  failureOutcome,
  parseClaudeCodeOutput,
  parseCodexCliOutput,
  parseGeminiCliOutput,
  parseAgyCliOutput,
  parseOpenAiChatResponse,
  refusedReason,
  retryWait,
  webToolsDirectOnly,
  type CliOutcome,
} from './ai-provider-parse';
import type { AiProviderId } from './ai-engine';
import { AI_KEY_ENV_VARS } from './ai-keys';
import { createLimiter, type Limiter } from './concurrency';
import { cliCommand } from './cli-command';

/**
 * The single seam between the callers and whatever runs the AI (ADR 0013/0014).
 *
 * - `anthropic_api`: Messages API via the SDK (pay per token, prompt cache).
 * - `claude_code`:   headless `claude -p` — uses the Claude.ai subscription
 *                    that the CLI is logged into. Slower (one process per
 *                    call, ~5k tokens of CLI system prompt per call) and
 *                    subject to the subscription's rolling usage window.
 * - `gemini_cli`:    headless `gemini -p` — Google account subscription or
 *                    GEMINI_API_KEY. Same process-per-call trade-offs.
 * - `openai_api`:    OpenAI-compatible POST /chat/completions via fetch —
 *                    covers OpenAI, OpenRouter, Groq, DeepSeek and local
 *                    servers through OPENAI_BASE_URL.
 * - `codex_cli`:     headless `codex exec` — ChatGPT subscription login or
 *                    OPENAI_API_KEY.
 *
 * All return the raw text; callers own JSON extraction + zod validation —
 * and, beside it, how the attempt ended and what it spent (ADR 0055).
 */
export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Short tag for log lines, e.g. 'classifier' / 'prefilter'. */
  label: string;
  /** Model id; callers pass the resolved engine model (src/ai-runtime.ts). */
  model?: string;
  /** Per-call ceiling for a CLI process (default CLI_TIMEOUT_MS). */
  timeoutMs?: number;
  /**
   * Let the model search and fetch the web before answering (server tools on
   * the API, WebSearch/WebFetch on the CLI). Only the final text comes back.
   */
  webTools?: boolean;
  /**
   * Credential for this engine, already resolved DB-key-first (ADR 0027).
   * Absent means "whatever .env holds" — the path scripts still take.
   */
  apiKey?: string;
  /** The server the OpenAI-compatible or the local engine talks to, as the AI tab set it; absent = .env's. */
  baseUrl?: string;
  /** The caller parses JSON: a transport that can hold the model to it does (the local engine's JSON mode). */
  json?: boolean;
  /** The local engine's context window, in tokens (ADR 0057). */
  contextTokens?: number;
  /**
   * Called with a one-line reason just before complete() resolves null. The
   * /settings connectivity test uses it to name the real cause instead of
   * sending the user to the container logs; every production call site still
   * treats a failure as "no answer" and ignores this.
   */
  onError?: (reason: string) => void;
}

/** One attempt: the reply or null, how it ended, and what the vendor said it spent. */
export interface AiAttempt {
  /** The model text, or null after logging the failure — and after handing the reason to req.onError. */
  text: string | null;
  outcome: AiOutcome;
  /** Null when the vendor reported nothing: a timeout, a refused key, a crash. */
  spend: AiSpend | null;
}

export interface AiProvider {
  readonly name: string;
  complete(req: AiRequest): Promise<AiAttempt>;
}

const failed = (outcome: AiOutcome, spend: AiSpend | null = null): AiAttempt => ({ text: null, outcome, spend });

// Server-side web tools pause after ~10 tool calls (stop_reason pause_turn);
// re-sending the turn resumes them. Cap the resumes so a search spiral ends.
const MAX_PAUSE_TURN_RESUMES = 5;
const WEB_SEARCH_MAX_USES = 10;
const WEB_FETCH_MAX_USES = 6;
const CLI_TIMEOUT_MS = 180_000;
const CLI_MAX_BUFFER = 1024 * 1024;
// gpt-5 / o-series burn completion tokens on reasoning before any output;
// low effort + headroom keeps small-maxTokens JSON calls from truncating.
const OPENAI_REASONING_MODEL = /^(gpt-5|o\d)/;
const OPENAI_REASONING_HEADROOM_TOKENS = 2_048;
const OPENAI_FALLBACK_MODEL = 'gpt-5-mini';
/** Calls one local server runs at a time; the rest wait their turn (ADR 0057). */
const LOCAL_CALLS_AT_ONCE = 1;
/** A local call that got its turn with less than this left is not worth starting. */
const MIN_LOCAL_CALL_MS = 5_000;

const execFileAsync = promisify(execFile);

/**
 * The human sentence inside a thrown provider error. The Anthropic SDK keeps
 * the API's own message under .error.error.message, while err.message wraps
 * it in the raw JSON body — readable in a log, useless in a flash message.
 */
function errorReason(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const body = err.error as { error?: { message?: unknown } } | undefined;
    const inner = body?.error?.message;
    if (typeof inner === 'string' && inner.trim().length > 0) return inner;
  }
  return err instanceof Error ? err.message : String(err);
}

class AnthropicApiProvider implements AiProvider {
  readonly name = 'anthropic_api';
  // The key can change under a running process (ADR 0027), so the SDK client
  // is rebuilt when it does — one slot, because it changes about never.
  private cached: { key: string; client: Anthropic } | null = null;

  private clientFor(key: string): Anthropic {
    // The SDK's own retries (two, waiting whatever Retry-After says, uncapped)
    // ran under the chain's deadline and on top of ours; the loop below owns
    // them now (H41).
    if (this.cached?.key !== key) this.cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 0 }) };
    return this.cached.client;
  }

  async complete(req: AiRequest): Promise<AiAttempt> {
    const key = req.apiKey ?? config.ANTHROPIC_API_KEY;
    if (!key) {
      logger.error({ label: req.label }, 'ai: no Anthropic API key — paste one on /settings');
      req.onError?.('no API key — paste one on /settings, or set it in .env');
      return failed('error');
    }
    // What the requests of this call spent so far: a web-search turn resumed
    // and then refused was still billed for the turns before it.
    const tally: { spend: AiSpend | null } = { spend: null };
    const deadline = Date.now() + (req.timeoutMs ?? CLI_TIMEOUT_MS);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.run(req, this.clientFor(key), tally);
      } catch (err) {
        const status = err instanceof Anthropic.APIError ? err.status : undefined;
        const reason = status ? `HTTP ${status}: ${errorReason(err)}` : errorReason(err);
        const timedOut = err instanceof Anthropic.APIConnectionTimeoutError;
        // A dropped connection is worth the retry a rate limit gets; a timeout already spent the budget.
        const kind = err instanceof Anthropic.APIConnectionError && !timedOut ? 'transient' : failureKind(status, errorReason(err));
        const headers = err instanceof Anthropic.APIError ? err.headers : undefined;
        const wait = attempt === 0 && kind === 'transient' ? retryWait((n) => headers?.get(n), deadline - Date.now(), Date.now()) : null;
        if (wait !== null) {
          logger.warn({ label: req.label, status, waitMs: wait }, 'ai: request failed, one more try');
          await sleep(wait);
          continue;
        }
        logger.error({ err, status, label: req.label }, 'ai: request failed');
        req.onError?.(describeAiFailure(kind === 'auth' ? refusedReason(reason, 'key') : reason));
        // The request that failed is not billed; the ones before it were.
        return failed(timedOut ? 'timeout' : failureOutcome(kind), tally.spend);
      }
    }
  }

  /** A reply the API billed and the caller cannot use: logged and reported as the thrown errors are. */
  private refuse(req: AiRequest, outcome: AiOutcome, reason: string, spend: AiSpend): AiAttempt {
    logger.error({ label: req.label, outcome }, `ai: request failed: ${reason}`);
    req.onError?.(describeAiFailure(reason));
    return failed(outcome, spend);
  }

  private async run(req: AiRequest, client: Anthropic, tally: { spend: AiSpend | null }): Promise<AiAttempt> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: req.user }];
    const model = req.model ?? config.CLAUDE_MODEL;
    const callers = webToolsDirectOnly(model) ? { allowed_callers: ['direct' as const] } : {};
    const tools = req.webTools
      ? [
          { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: WEB_SEARCH_MAX_USES, ...callers },
          { type: 'web_fetch_20260209' as const, name: 'web_fetch' as const, max_uses: WEB_FETCH_MAX_USES, ...callers },
        ]
      : undefined;
    // A paused web-search turn is resumed as a new request: each is billed, so they add.
    let usage = tally.spend?.usage ?? NO_USAGE;
    for (let resumes = 0; ; resumes++) {
      // The same ceiling the chain hands every other backend; without it the
      // SDK's own ten minutes was the only limit and the chain's deadline
      // could not bind on this path (audit 2026-09-10, AI-1).
      const resp = await client.messages.create(
        {
          model,
          max_tokens: anthropicMaxTokens(req.maxTokens),
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages,
          tools,
        },
        { timeout: req.timeoutMs ?? CLI_TIMEOUT_MS },
      );
      logger.info(
        {
          label: req.label,
          provider: this.name,
          model: resp.model,
          stop: resp.stop_reason,
          inputTokens: resp.usage.input_tokens,
          cacheRead: resp.usage.cache_read_input_tokens,
          outputTokens: resp.usage.output_tokens,
          thinkingTokens: resp.usage.output_tokens_details?.thinking_tokens,
        },
        'ai: reply',
      );
      usage = addUsage(usage, anthropicUsage(resp.usage));
      const spend: AiSpend = { usage, model: resp.model, reportedUsd: null };
      tally.spend = spend;
      if (resp.stop_reason === 'pause_turn' && resumes < MAX_PAUSE_TURN_RESUMES) {
        messages.push({ role: 'assistant', content: resp.content });
        continue;
      }
      // An incomplete reply is a failure, not an answer: every caller parses
      // JSON, and a cut-off one used to come back as "no JSON object" (#159).
      if (resp.stop_reason === 'max_tokens') {
        const { output_tokens, output_tokens_details } = resp.usage;
        return this.refuse(
          req,
          'cut_off',
          `reply cut off at ${output_tokens} output tokens (${output_tokens_details?.thinking_tokens ?? 0} of them thinking)`,
          spend,
        );
      }
      if (resp.stop_reason === 'refusal') {
        return this.refuse(req, 'refused', `the model declined this request (${resp.stop_details?.category ?? 'no category given'})`, spend);
      }
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      // A reply with no text is not an answer: handed on as one, it spent a
      // parse retry instead of a failover to an engine that talks.
      if (text.trim().length === 0) return this.refuse(req, 'empty', 'the model returned no text', spend);
      return { text, outcome: 'ok', spend };
    }
  }
}

/** OpenAI-compatible chat completions over fetch — no SDK dependency. */
class OpenAiApiProvider implements AiProvider {
  readonly name = 'openai_api';

  constructor(private readonly defaultBaseUrl: string) {}

  async complete(req: AiRequest): Promise<AiAttempt> {
    // The server set on the AI tab rides on the request (TASKS S1); .env's is the fallback.
    const baseUrl = req.baseUrl ?? this.defaultBaseUrl;
    const apiKey = req.apiKey ?? config.OPENAI_API_KEY;
    // A local server (Ollama, LM Studio, llama.cpp) needs no key and gets none.
    if (!apiKey && !isLocalUrl(baseUrl)) {
      logger.error({ label: req.label }, 'ai: no OpenAI API key — paste one on /settings');
      req.onError?.('no API key — paste one on /settings, or set it in .env');
      return failed('error');
    }
    const model = req.model || config.OPENAI_MODEL || OPENAI_FALLBACK_MODEL;
    // api.openai.com rejects max_tokens for reasoning models; most
    // compatible servers (OpenRouter, Groq, local) only know max_tokens.
    const isOpenAi = baseUrl.includes('api.openai.com');
    const reasoning = isOpenAi && OPENAI_REASONING_MODEL.test(model);
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      ...(isOpenAi
        ? {
            max_completion_tokens:
              req.maxTokens + (reasoning ? OPENAI_REASONING_HEADROOM_TOKENS : 0),
          }
        : { max_tokens: req.maxTokens }),
      ...(reasoning ? { reasoning_effort: 'low' } : {}),
    });
    const deadline = Date.now() + (req.timeoutMs ?? CLI_TIMEOUT_MS);
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      // A retry runs on what is left of the attempt's budget, not on a fresh one.
      const timer = setTimeout(() => ctrl.abort(), Math.max(1, deadline - Date.now()));
      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
            'Content-Type': 'application/json',
          },
          body,
          signal: ctrl.signal,
        });
        const raw = await resp.text();
        const out = parseOpenAiChatResponse(raw);
        if (out.text !== null) return { text: out.text, outcome: 'ok', spend: out.spend ?? null };
        const reason = `HTTP ${resp.status}: ${out.error ?? 'no reply text'}`;
        // A reply that parsed (cut off, filtered, empty) is judged by its outcome; the status speaks for the rest.
        const kind = out.outcome ? 'other' : failureKind(resp.status, out.error ?? '');
        const wait = attempt === 0 && kind === 'transient' ? retryWait((n) => resp.headers.get(n), deadline - Date.now(), Date.now()) : null;
        if (wait !== null) {
          logger.warn({ label: req.label, status: resp.status, waitMs: wait }, 'ai: openai request failed, one more try');
          await sleep(wait);
          continue;
        }
        logger.error(
          { label: req.label, status: resp.status, error: out.error, model },
          'ai: openai request failed',
        );
        req.onError?.(describeAiFailure(kind === 'auth' ? refusedReason(reason, 'key') : reason));
        return failed(out.outcome ?? failureOutcome(kind), out.spend ?? null);
      } catch (err) {
        logger.error({ err, label: req.label, model }, 'ai: openai request failed');
        req.onError?.(describeAiFailure(errorReason(err)));
        return failed(ctrl.signal.aborted ? 'timeout' : 'error');
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

/**
 * A model on this machine through Ollama's own API (ADR 0057): the context
 * window set per call, JSON mode where the caller parses JSON, the reply
 * streamed so a long generation is not cut by Node's header timeout, and one
 * call at a time per server — three at once on one GPU run at a third of the
 * speed each and time out together. A prompt the window cannot hold is
 * refused before it is sent: the server would cut it from the start, where
 * the rules are, and answer anyway.
 */
class LocalApiProvider implements AiProvider {
  readonly name = 'local_api';
  private readonly slots = new Map<string, Limiter>();

  async complete(req: AiRequest): Promise<AiAttempt> {
    const root = req.baseUrl ?? config.OLLAMA_URL;
    const model = req.model || config.LOCAL_MODEL;
    if (!model) {
      req.onError?.('no model chosen for the local engine — pick one on Settings → AI engine');
      return failed('error');
    }
    const contextTokens = req.contextTokens ?? DEFAULT_LOCAL_CONTEXT_TOKENS;
    const need = localBudgetTokens(req.system, req.user, req.maxTokens);
    if (need > contextTokens) {
      logger.warn({ label: req.label, need, contextTokens }, 'ai: prompt larger than the local context window');
      req.onError?.(
        `this call needs about ${need.toLocaleString('en-US')} tokens and the local context window is ${contextTokens.toLocaleString('en-US')} — a larger window on Settings → AI engine, or the engine behind this one, takes it`,
      );
      return failed('error');
    }
    const deadline = Date.now() + (req.timeoutMs ?? CLI_TIMEOUT_MS);
    const slot = this.slots.get(root) ?? createLimiter(LOCAL_CALLS_AT_ONCE);
    this.slots.set(root, slot);
    return slot(() => this.send(req, root, model, contextTokens, deadline));
  }

  private async send(req: AiRequest, root: string, model: string, contextTokens: number, deadline: number): Promise<AiAttempt> {
    const remainingMs = deadline - Date.now();
    if (remainingMs < MIN_LOCAL_CALL_MS) {
      req.onError?.('the local model was busy with other calls for all the time this one had');
      return failed('timeout');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), remainingMs);
    try {
      const resp = await fetch(`${root}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildOllamaChatBody({ system: req.system, user: req.user, model, maxTokens: req.maxTokens, contextTokens, json: req.json }),
        signal: ctrl.signal,
      });
      const raw = await resp.text();
      if (!resp.ok) {
        const message = ollamaError(raw) ?? 'no reason given';
        logger.error({ label: req.label, status: resp.status, error: message, model }, 'ai: local request failed');
        req.onError?.(describeAiFailure(resp.status === 404 ? `${message} — pull it first: ollama pull ${model}` : `HTTP ${resp.status}: ${message}`));
        return failed('error');
      }
      const out = parseOllamaStream(raw);
      if (out.text !== null) {
        logger.info(
          { label: req.label, provider: this.name, model, inputTokens: out.spend?.usage.inputTokens, outputTokens: out.spend?.usage.outputTokens },
          'ai: reply',
        );
        return { text: out.text, outcome: 'ok', spend: out.spend ?? null };
      }
      logger.error({ label: req.label, error: out.error, model }, 'ai: local reply unusable');
      req.onError?.(describeAiFailure(out.error ?? 'no reply'));
      return failed(out.outcome ?? 'error', out.spend ?? null);
    } catch (err) {
      const timedOut = ctrl.signal.aborted;
      logger.error({ err, label: req.label, model }, 'ai: local request failed');
      req.onError?.(timedOut ? `no reply within ${Math.round(remainingMs / 1000)} s` : `nothing answered at ${root} — is Ollama running?`);
      return failed(timedOut ? 'timeout' : 'error');
    } finally {
      clearTimeout(timer);
    }
  }
}

interface CliSpec {
  buildArgs(req: { system: string; user: string; model: string; webTools?: boolean }): string[];
  parse(raw: string): CliOutcome;
  defaultModel: string;
  /** Auth variables this provider's child may see (buildCliEnv allowlist). */
  envKeys: readonly string[];
  /** Which of those carries a pasted key, when the request brings one. */
  keyEnv?: string;
  /** Working directory — set to keep the CLI away from workspace context. */
  cwd?: string;
  /** This CLI reads MAX_THINKING_TOKENS: tool-free calls get it capped (#168). */
  thinkingCap?: boolean;
  /** Set on every call, whatever the request. */
  fixedEnv?: Readonly<Record<string, string>>;
}

/**
 * CLI children in flight, and whether new ones are refused. A process on its
 * way out ends them (H43): orphaned, a CLI ran on to its timeout on the
 * user's plan, for an answer nobody would read.
 */
const liveChildren = new Set<ChildProcess>();
let stopping = false;

/** Kills every CLI child in flight and refuses new ones; the count, for the shutdown log. */
export function stopCliChildren(): number {
  stopping = true;
  const killed = liveChildren.size;
  for (const child of liveChildren) {
    child.kill('SIGKILL');
    // A process the CLI started itself would hold our end of the pipes open,
    // and the call with them: closed here, the call ends now.
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  liveChildren.clear();
  return killed;
}

/** Headless-CLI backend: spawn, parse JSON stdout, one retry on a rate limit or an overloaded server. */
class CliProvider implements AiProvider {
  constructor(
    readonly name: string,
    private readonly bin: string,
    private readonly spec: CliSpec,
  ) {}

  async complete(req: AiRequest): Promise<AiAttempt> {
    if (stopping) {
      req.onError?.('ApplyPack is shutting down');
      return failed('error');
    }
    const args = this.spec.buildArgs({
      system: req.system,
      user: req.user,
      model: req.model ?? this.spec.defaultModel,
      webTools: req.webTools,
    });
    const budgetMs = req.timeoutMs ?? CLI_TIMEOUT_MS;
    const deadline = Date.now() + budgetMs;
    for (let attempt = 0; ; attempt++) {
      // On Windows an npm shim runs as Node + its script, never through a shell (S8).
      const command = cliCommand(this.bin);
      const run = execFileAsync(command.file, [...command.prefix, ...args], {
        // A retry runs on what is left of the attempt's budget, not on a fresh one.
        timeout: Math.max(1, deadline - Date.now()),
        // A child past its budget is killed, not asked: execFile never
        // escalates past SIGTERM, and a CLI that traps it would hold the
        // tick past every deadline (AI-2). The CLIs keep no state to flush.
        killSignal: 'SIGKILL',
        maxBuffer: CLI_MAX_BUFFER,
        cwd: this.spec.cwd,
        env: buildCliEnv(this.spec.envKeys, this.envSource(req)),
      });
      // Nothing is ever written to a CLI's stdin. Closed at once, a CLI that
      // reads it when it is not a terminal (Codex, the Gemini CLI) meets its
      // end instead of waiting on it until the timeout.
      run.child.stdin?.end();
      liveChildren.add(run.child);
      let result: { stdout: string } | { err: unknown };
      try {
        result = { stdout: (await run).stdout };
      } catch (err) {
        result = { err };
      } finally {
        liveChildren.delete(run.child);
      }
      if ('err' in result) {
        if (stopping) {
          req.onError?.('stopped: ApplyPack is shutting down');
          return failed('error');
        }
        // execFile puts the whole command line — prompt included — in
        // err.message, so neither the log line nor the flash may carry `err`:
        // the reason is read off stderr, the exit code and the signal.
        const failure = cliFailure(result.err, budgetMs);
        // A CLI that exits non-zero may still have printed its result, usage
        // included (Claude Code does — a rate limit too): what it spent, and
        // whether one more try is worth it, is read off that.
        const e = result.err as { killed?: unknown; stdout?: unknown };
        const printed = typeof e.stdout === 'string' && e.stdout.trim() ? this.spec.parse(e.stdout) : null;
        if (e.killed !== true && printed && (await this.waitedToRetry(req, printed, attempt, deadline))) continue;
        logger.error({ label: req.label, provider: this.name, ...failure.log }, 'ai: cli process failed');
        const refused = printed?.outcome === 'unauthorized' || failureKind(null, failure.reason) === 'auth';
        // The CLI's own sentence, when it printed one, says more than its exit code.
        const reason = printed?.error ?? `${this.bin}: ${failure.reason}`;
        req.onError?.(describeAiFailure(refused ? refusedReason(reason, 'sign-in') : reason));
        return failed(e.killed === true ? 'timeout' : refused ? 'unauthorized' : (printed?.outcome ?? 'error'), printed?.spend ?? null);
      }
      const parsedOut = this.spec.parse(result.stdout);
      // An empty reply is a failure to fail over from, not a text to parse.
      const out =
        parsedOut.text !== null && parsedOut.text.trim().length === 0
          ? { ...parsedOut, text: null, error: 'the CLI returned no text' }
          : parsedOut;
      if (out.text !== null) {
        logger.info({ label: req.label, provider: this.name, model: req.model, ...out.usage }, 'ai: reply');
        return { text: out.text, outcome: 'ok', spend: out.spend ?? null };
      }
      if (await this.waitedToRetry(req, out, attempt, deadline)) continue;
      logger.error(
        { label: req.label, provider: this.name, error: out.error, rateLimited: out.rateLimited },
        'ai: cli returned an error',
      );
      const reason = out.error ?? 'the CLI returned no text';
      req.onError?.(describeAiFailure(out.outcome === 'unauthorized' ? refusedReason(reason, 'sign-in') : reason));
      const outcome = parsedOut.text !== null ? 'empty' : (out.outcome ?? (out.rateLimited ? 'rate_limited' : 'error'));
      return failed(outcome, out.spend ?? null);
    }
  }

  /**
   * The one retry a CLI gets, for a limit that clears in seconds (H41). A CLI
   * names no wait, so it is the default one; true when it waited.
   */
  private async waitedToRetry(req: AiRequest, out: CliOutcome, attempt: number, deadline: number): Promise<boolean> {
    const wait = attempt === 0 && cliRetryable(out) ? retryWait(() => null, deadline - Date.now(), Date.now()) : null;
    if (wait === null) return false;
    logger.warn({ label: req.label, provider: this.name, waitMs: wait }, 'ai: cli rate-limited, one more try');
    await sleep(wait);
    return true;
  }

  /**
   * A pasted key reaches the CLI the only way it reads one: as its own auth
   * variable in the child env, still filtered by the buildCliEnv allowlist.
   */
  private envSource(req: AiRequest): NodeJS.ProcessEnv {
    const { keyEnv, thinkingCap, fixedEnv } = this.spec;
    return {
      ...process.env,
      ...fixedEnv,
      ...(keyEnv && req.apiKey ? { [keyEnv]: req.apiKey } : {}),
      ...(thinkingCap ? cliThinkingCap(req.webTools) : {}),
    };
  }
}

const providers = new Map<AiProviderId, AiProvider>();

/**
 * Lazily constructs and caches the backend. Credentials are not baked in: a
 * key arrives per call on AiRequest (ADR 0027), and whether an engine has one
 * at all is decided in one place — ai-engine.ts:providerUnusable.
 */
export function getAiProviderById(id: AiProviderId): AiProvider {
  const cached = providers.get(id);
  if (cached) return cached;
  let provider: AiProvider;
  switch (id) {
    case 'anthropic_api':
      provider = new AnthropicApiProvider();
      break;
    case 'claude_code':
      provider = new CliProvider('claude_code', config.CLAUDE_CODE_BIN, {
        buildArgs: buildClaudeCodeArgs,
        parse: parseClaudeCodeOutput,
        defaultModel: config.CLAUDE_MODEL,
        envKeys: CLI_PROVIDER_ENV_KEYS.claude_code ?? [],
        keyEnv: AI_KEY_ENV_VARS.claude_code,
        thinkingCap: true,
        // Never the checkout's CLAUDE.md or memory (CLAUDE_CODE_ISOLATION_ENV).
        fixedEnv: CLAUDE_CODE_ISOLATION_ENV,
        cwd: tmpdir(),
      });
      break;
    case 'gemini_cli':
      provider = new CliProvider('gemini_cli', config.GEMINI_CLI_BIN, {
        buildArgs: buildGeminiCliArgs,
        parse: parseGeminiCliOutput,
        defaultModel: 'gemini-2.5-flash',
        envKeys: CLI_PROVIDER_ENV_KEYS.gemini_cli ?? [],
        keyEnv: AI_KEY_ENV_VARS.gemini_cli,
        // gemini has no --tools '' switch; an empty cwd keeps it from
        // ingesting workspace files (GEMINI.md, sources) as context.
        cwd: tmpdir(),
      });
      break;
    case 'agy_cli':
      provider = new CliProvider('agy_cli', config.AGY_CLI_BIN, {
        buildArgs: buildAgyCliArgs,
        parse: parseAgyCliOutput,
        defaultModel: 'gemini-3.8-flash-high',
        envKeys: CLI_PROVIDER_ENV_KEYS.agy_cli ?? [],
        cwd: tmpdir(),
      });
      break;
    case 'openai_api':
      provider = new OpenAiApiProvider(config.OPENAI_BASE_URL);
      break;
    case 'local_api':
      provider = new LocalApiProvider();
      break;
    case 'codex_cli':
      provider = new CliProvider('codex_cli', config.CODEX_CLI_BIN, {
        buildArgs: buildCodexCliArgs,
        parse: parseCodexCliOutput,
        // '' = let the CLI use its configured default model.
        defaultModel: '',
        envKeys: CLI_PROVIDER_ENV_KEYS.codex_cli ?? [],
        cwd: tmpdir(),
      });
      break;
  }
  providers.set(id, provider);
  logger.info({ provider: id }, 'ai: provider ready');
  return provider;
}

/** The .env-configured backend (scripts; runtime code uses getAiRuntime). */
export function getAiProvider(): AiProvider {
  return getAiProviderById(config.AI_PROVIDER);
}
