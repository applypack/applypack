import 'dotenv/config';
import { z } from 'zod';
import { AI_PROVIDER_IDS } from './ai-engine';

export const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Default AI backend; /settings → "AI engine" can override it at runtime.
  AI_PROVIDER: z.enum(AI_PROVIDER_IDS).default('anthropic_api'),
  // Optional on purpose, even when AI_PROVIDER selects it. The engine chain
  // resolves at runtime from the database with .env as fallback (ADR 0013/0014):
  // /settings → "AI engine" reports `set ANTHROPIC_API_KEY in .env` and the
  // provider factory throws the same message if this engine is ever used.
  // Failing the process here took down the dashboard — the one place the
  // credential can be set — so `cp .env.example .env` could not reach the UI.
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  // Resume scan + resume-vs-job comparison: a few calls a day where judgment
  // matters more than cost, so a stronger model than the classifier's.
  CLAUDE_MODEL_RESUME: z.string().default('claude-opus-5'),
  // Path to the Claude Code CLI when AI_PROVIDER=claude_code.
  CLAUDE_CODE_BIN: z.string().default('claude'),
  // Path to the Gemini CLI when the gemini_cli engine is selected.
  GEMINI_CLI_BIN: z.string().default('gemini'),
  // Path to the Codex CLI when the codex_cli engine is selected.
  CODEX_CLI_BIN: z.string().default('codex'),
  // OpenAI-compatible API engine: any server that speaks /chat/completions
  // (OpenAI, OpenRouter, Groq, local LM Studio / Ollama).
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  // Default model for the openai_api engine when the dashboard slot is empty.
  OPENAI_MODEL: z.string().default(''),
  // How many jobs are classified at the same time (both providers).
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TZ: z.string().default('UTC'),
  MIN_FIT_SCORE: z.coerce.number().int().min(0).max(100).default(70),
  MIN_SALARY_USD: z.coerce.number().int().min(0).default(0),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(4747),
  // Loopback by default: an unauthenticated dashboard must never land on a
  // network because a .env was missing. docker-compose sets 0.0.0.0 for the
  // container, whose published port is loopback-only; a bare `docker run`
  // needs `-e WEB_HOST=0.0.0.0` for the same reason.
  WEB_HOST: z.string().default('127.0.0.1'),
  WEB_BASIC_AUTH: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config: Config = loadConfig();
