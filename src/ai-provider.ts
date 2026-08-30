import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { config } from './config';
import { logger } from './logger';
import { sleep } from './http';
import {
  buildClaudeCodeArgs,
  buildCliEnv,
  buildCodexCliArgs,
  buildGeminiCliArgs,
  CLI_PROVIDER_ENV_KEYS,
  parseClaudeCodeOutput,
  parseCodexCliOutput,
  parseGeminiCliOutput,
  parseOpenAiChatResponse,
  type CliOutcome,
} from './ai-provider-parse';
import type { AiProviderId } from './ai-engine';

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
 * All return the raw text; callers own JSON extraction + zod validation.
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
}

export interface AiProvider {
  readonly name: string;
  /** Returns the model text, or null after logging the failure. */
  complete(req: AiRequest): Promise<string | null>;
}

const RATE_LIMIT_RETRY_DELAY_MS = 2_000;
const MAX_ATTEMPTS = 2;
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

const execFileAsync = promisify(execFile);

class AnthropicApiProvider implements AiProvider {
  readonly name = 'anthropic_api';
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(req: AiRequest): Promise<string | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await this.run(req);
      } catch (err) {
        const status = err instanceof Anthropic.APIError ? err.status : undefined;
        if (status === 429 && attempt < MAX_ATTEMPTS - 1) {
          logger.warn({ label: req.label }, 'ai: rate-limited, retrying');
          await sleep(RATE_LIMIT_RETRY_DELAY_MS);
          continue;
        }
        logger.error({ err, status, label: req.label }, 'ai: request failed');
        return null;
      }
    }
    return null;
  }

  private async run(req: AiRequest): Promise<string> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: req.user }];
    const tools = req.webTools
      ? [
          { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: WEB_SEARCH_MAX_USES },
          { type: 'web_fetch_20260209' as const, name: 'web_fetch' as const, max_uses: WEB_FETCH_MAX_USES },
        ]
      : undefined;
    for (let resumes = 0; ; resumes++) {
      const resp = await this.client.messages.create({
        model: req.model ?? config.CLAUDE_MODEL,
        max_tokens: req.maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages,
        tools,
      });
      if (resp.stop_reason === 'pause_turn' && resumes < MAX_PAUSE_TURN_RESUMES) {
        messages.push({ role: 'assistant', content: resp.content });
        continue;
      }
      return resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }
  }
}

/** OpenAI-compatible chat completions over fetch — no SDK dependency. */
class OpenAiApiProvider implements AiProvider {
  readonly name = 'openai_api';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async complete(req: AiRequest): Promise<string | null> {
    const model = req.model || config.OPENAI_MODEL || OPENAI_FALLBACK_MODEL;
    // api.openai.com rejects max_tokens for reasoning models; most
    // compatible servers (OpenRouter, Groq, local) only know max_tokens.
    const isOpenAi = this.baseUrl.includes('api.openai.com');
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
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? CLI_TIMEOUT_MS);
      try {
        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: ctrl.signal,
        });
        const raw = await resp.text();
        const out = parseOpenAiChatResponse(raw);
        if (out.text !== null) return out.text;
        const rateLimited = out.rateLimited || resp.status === 429;
        if (rateLimited && attempt < MAX_ATTEMPTS - 1) {
          logger.warn({ label: req.label }, 'ai: openai rate-limited, retrying');
          await sleep(RATE_LIMIT_RETRY_DELAY_MS);
          continue;
        }
        logger.error(
          { label: req.label, status: resp.status, error: out.error, model },
          'ai: openai request failed',
        );
        return null;
      } catch (err) {
        logger.error({ err, label: req.label, model }, 'ai: openai request failed');
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }
}

interface CliSpec {
  buildArgs(req: { system: string; user: string; model: string; webTools?: boolean }): string[];
  parse(raw: string): CliOutcome;
  defaultModel: string;
  /** Auth variables this provider's child may see (buildCliEnv allowlist). */
  envKeys: readonly string[];
  /** Working directory — set to keep the CLI away from workspace context. */
  cwd?: string;
}

/** Headless-CLI backend: spawn, parse JSON stdout, one retry on rate limit. */
class CliProvider implements AiProvider {
  constructor(
    readonly name: string,
    private readonly bin: string,
    private readonly spec: CliSpec,
  ) {}

  async complete(req: AiRequest): Promise<string | null> {
    const args = this.spec.buildArgs({
      system: req.system,
      user: req.user,
      model: req.model ?? this.spec.defaultModel,
      webTools: req.webTools,
    });
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(this.bin, args, {
          timeout: req.timeoutMs ?? CLI_TIMEOUT_MS,
          maxBuffer: CLI_MAX_BUFFER,
          cwd: this.spec.cwd,
          env: buildCliEnv(this.spec.envKeys),
        }));
      } catch (err) {
        logger.error({ err, label: req.label, provider: this.name }, 'ai: cli process failed');
        return null;
      }
      const out = this.spec.parse(stdout);
      if (out.text !== null) return out.text;
      if (out.rateLimited && attempt < MAX_ATTEMPTS - 1) {
        logger.warn({ label: req.label, provider: this.name }, 'ai: cli rate-limited, retrying');
        await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        continue;
      }
      logger.error(
        { label: req.label, provider: this.name, error: out.error, rateLimited: out.rateLimited },
        'ai: cli returned an error',
      );
      return null;
    }
    return null;
  }
}

const providers = new Map<AiProviderId, AiProvider>();

/**
 * Lazily constructs and caches the backend. Throws for anthropic_api without
 * an API key — ai-runtime's resolution never selects it in that case.
 */
export function getAiProviderById(id: AiProviderId): AiProvider {
  const cached = providers.get(id);
  if (cached) return cached;
  let provider: AiProvider;
  switch (id) {
    case 'anthropic_api': {
      if (!config.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is required for the anthropic_api provider');
      }
      provider = new AnthropicApiProvider(config.ANTHROPIC_API_KEY);
      break;
    }
    case 'claude_code':
      provider = new CliProvider('claude_code', config.CLAUDE_CODE_BIN, {
        buildArgs: buildClaudeCodeArgs,
        parse: parseClaudeCodeOutput,
        defaultModel: config.CLAUDE_MODEL,
        envKeys: CLI_PROVIDER_ENV_KEYS.claude_code ?? [],
      });
      break;
    case 'gemini_cli':
      provider = new CliProvider('gemini_cli', config.GEMINI_CLI_BIN, {
        buildArgs: buildGeminiCliArgs,
        parse: parseGeminiCliOutput,
        defaultModel: 'gemini-2.5-flash',
        envKeys: CLI_PROVIDER_ENV_KEYS.gemini_cli ?? [],
        // gemini has no --tools '' switch; an empty cwd keeps it from
        // ingesting workspace files (GEMINI.md, sources) as context.
        cwd: tmpdir(),
      });
      break;
    case 'openai_api': {
      if (!config.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is required for the openai_api provider');
      }
      provider = new OpenAiApiProvider(config.OPENAI_API_KEY, config.OPENAI_BASE_URL);
      break;
    }
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
