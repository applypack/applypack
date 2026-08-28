import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Which backend runs the classifier. See src/ai-provider.ts.
  AI_PROVIDER: z.enum(['anthropic_api', 'claude_code']).default('anthropic_api'),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  // Resume scan + resume-vs-job comparison: a few calls a day where judgment
  // matters more than cost, so a stronger model than the classifier's.
  CLAUDE_MODEL_RESUME: z.string().default('claude-opus-5'),
  // Path to the Claude Code CLI when AI_PROVIDER=claude_code.
  CLAUDE_CODE_BIN: z.string().default('claude'),
  // How many jobs are classified at the same time (both providers).
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TZ: z.string().default('America/Chicago'),
  MIN_FIT_SCORE: z.coerce.number().int().min(0).max(100).default(70),
  MIN_SALARY_USD: z.coerce.number().int().min(0).default(120000),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(4747),
  WEB_HOST: z.string().default('0.0.0.0'),
  WEB_BASIC_AUTH: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
}).refine(
  (c) => c.AI_PROVIDER !== 'anthropic_api' || (c.ANTHROPIC_API_KEY ?? '').length > 0,
  { path: ['ANTHROPIC_API_KEY'], message: 'required when AI_PROVIDER=anthropic_api' },
);

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
