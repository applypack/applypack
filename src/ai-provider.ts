import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config';
import { logger } from './logger';
import { sleep } from './http';
import { buildClaudeCodeArgs, parseClaudeCodeOutput } from './ai-provider-parse';

/**
 * The single seam between the classifiers and whatever runs Claude.
 *
 * - `anthropic_api`: Messages API via the SDK (pay per token, prompt cache).
 * - `claude_code`:   headless `claude -p` — uses the Claude.ai subscription
 *                    that the CLI is logged into. Slower (one process per
 *                    call, ~5k tokens of CLI system prompt per call) and
 *                    subject to the subscription's rolling usage window.
 *
 * Both return the raw text; callers own JSON extraction + zod validation.
 */
export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Short tag for log lines, e.g. 'classifier' / 'prefilter'. */
  label: string;
  /** Model id; defaults to CLAUDE_MODEL. */
  model?: string;
  /** Per-call ceiling for the claude_code process (default CLAUDE_CODE_TIMEOUT_MS). */
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
const CLAUDE_CODE_TIMEOUT_MS = 180_000;
const CLAUDE_CODE_MAX_BUFFER = 1024 * 1024;

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

class ClaudeCodeProvider implements AiProvider {
  readonly name = 'claude_code';

  constructor(private readonly bin: string) {}

  async complete(req: AiRequest): Promise<string | null> {
    const args = buildClaudeCodeArgs({
      system: req.system,
      user: req.user,
      model: req.model ?? config.CLAUDE_MODEL,
      webTools: req.webTools,
    });
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(this.bin, args, {
          timeout: req.timeoutMs ?? CLAUDE_CODE_TIMEOUT_MS,
          maxBuffer: CLAUDE_CODE_MAX_BUFFER,
        }));
      } catch (err) {
        logger.error({ err, label: req.label }, 'ai: claude-code process failed');
        return null;
      }
      const out = parseClaudeCodeOutput(stdout);
      if (out.text !== null) return out.text;
      if (out.rateLimited && attempt < MAX_ATTEMPTS - 1) {
        logger.warn({ label: req.label }, 'ai: claude-code rate-limited, retrying');
        await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        continue;
      }
      logger.error(
        { label: req.label, error: out.error, rateLimited: out.rateLimited },
        'ai: claude-code returned an error',
      );
      return null;
    }
    return null;
  }
}

let provider: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (provider) return provider;
  if (config.AI_PROVIDER === 'claude_code') {
    provider = new ClaudeCodeProvider(config.CLAUDE_CODE_BIN);
  } else {
    // config.ts guarantees the key is present in this branch.
    provider = new AnthropicApiProvider(config.ANTHROPIC_API_KEY as string);
  }
  logger.info({ provider: provider.name, model: config.CLAUDE_MODEL }, 'ai: provider ready');
  return provider;
}
