import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config';
import { logger } from './logger';
import { sleep } from './http';
import { parseClaudeCodeOutput } from './ai-provider-parse';

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
}

export interface AiProvider {
  readonly name: string;
  /** Returns the model text, or null after logging the failure. */
  complete(req: AiRequest): Promise<string | null>;
}

const RATE_LIMIT_RETRY_DELAY_MS = 2_000;
const MAX_ATTEMPTS = 2;
// Calls normally finish in 15-30 s inside Docker, but with AI_CONCURRENCY
// in flight a few strayed past 90 s and lost their work to the timeout.
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
        const resp = await this.client.messages.create({
          model: config.CLAUDE_MODEL,
          max_tokens: req.maxTokens,
          system: [
            { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: req.user }],
        });
        return resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
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
}

class ClaudeCodeProvider implements AiProvider {
  readonly name = 'claude_code';

  constructor(private readonly bin: string) {}

  async complete(req: AiRequest): Promise<string | null> {
    const args = [
      '--print',
      '--output-format', 'json',
      '--model', config.CLAUDE_MODEL,
      '--system-prompt', req.system,
      '--tools', '',
      '--no-session-persistence',
      req.user,
    ];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(this.bin, args, {
          timeout: CLAUDE_CODE_TIMEOUT_MS,
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
