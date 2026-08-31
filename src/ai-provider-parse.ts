import { z } from 'zod';
import type { AiProviderId } from './ai-engine';

/**
 * Shape of `claude -p --output-format json`. Only the fields we act on are
 * declared; everything else (usage, cost, session id) passes through
 * untouched. Kept SDK-free so the parser can be unit-tested.
 */
const ClaudeCodeResultSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  api_error_status: z.number().nullable().optional(),
});

export interface CliOutcome {
  text: string | null;
  /** True for 429 / overloaded / quota — the caller may retry later. */
  rateLimited: boolean;
  error: string | null;
}

const RATE_LIMIT_STATUS = 429;
const RATE_LIMIT_PATTERN = /rate.?limit|usage limit|overloaded|resource.?exhausted|quota/i;

export function parseClaudeCodeOutput(raw: string): CliOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { text: null, rateLimited: false, error: 'claude-code: output is not JSON' };
  }
  const parsed = ClaudeCodeResultSchema.safeParse(json);
  if (!parsed.success) {
    return { text: null, rateLimited: false, error: 'claude-code: unexpected result shape' };
  }
  const r = parsed.data;
  if (r.is_error || r.subtype !== 'success') {
    const message = r.result ?? r.subtype;
    const rateLimited =
      r.api_error_status === RATE_LIMIT_STATUS || RATE_LIMIT_PATTERN.test(message);
    return { text: null, rateLimited, error: `claude-code: ${message}` };
  }
  return { text: r.result ?? '', rateLimited: false, error: null };
}

/**
 * Env allowlist for CLI child processes. A provider child gets the base
 * process keys plus ONLY its own auth variables — never the database URL,
 * Telegram token, or another provider's key. Load-bearing case: Claude Code
 * documents that ANTHROPIC_API_KEY takes precedence over subscription
 * login, so leaking it into the claude_code child would silently bill the
 * API while the user believes the subscription is working.
 */
const CLI_BASE_ENV_KEYS = [
  'PATH', 'HOME', 'SHELL', 'TERM', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ',
] as const;

export const CLI_PROVIDER_ENV_KEYS: Partial<Record<AiProviderId, readonly string[]>> = {
  claude_code: ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR'],
  gemini_cli: [
    'GEMINI_API_KEY',
    'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_GENAI_USE_GCA',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
  ],
  codex_cli: ['OPENAI_API_KEY', 'CODEX_HOME'],
};

export function buildCliEnv(
  providerKeys: readonly string[],
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [...CLI_BASE_ENV_KEYS, ...providerKeys]) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

const CLAUDE_CODE_WEB_TOOLS = 'WebSearch,WebFetch';

/**
 * Argument list for `claude -p`. With `webTools` the CLI may search and fetch
 * the web inside its own loop (pre-approved via --allowedTools, since headless
 * mode cannot prompt); otherwise every built-in tool is disabled.
 */
export function buildClaudeCodeArgs(req: {
  system: string;
  user: string;
  model: string;
  webTools?: boolean;
}): string[] {
  const tools = req.webTools
    ? ['--tools', CLAUDE_CODE_WEB_TOOLS, '--allowedTools', CLAUDE_CODE_WEB_TOOLS]
    : ['--tools', ''];
  return [
    '--print',
    '--output-format', 'json',
    '--model', req.model,
    '--system-prompt', req.system,
    ...tools,
    '--no-session-persistence',
    // The prompt is the positional argument and it carries untrusted text, so
    // end option parsing first: without this, a user prompt starting with "-"
    // is read as a flag and the CLI exits with "unknown option".
    '--',
    req.user,
  ];
}

/**
 * Shape of `gemini -p --output-format json`: success carries `response`,
 * failures an `error` object. Stats pass through untouched.
 */
const GeminiCliResultSchema = z.object({
  response: z.string().optional(),
  error: z
    .object({
      type: z.string().optional(),
      message: z.string(),
      code: z.union([z.number(), z.string()]).nullable().optional(),
    })
    .optional(),
});

export function parseGeminiCliOutput(raw: string): CliOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { text: null, rateLimited: false, error: 'gemini-cli: output is not JSON' };
  }
  const parsed = GeminiCliResultSchema.safeParse(json);
  if (!parsed.success) {
    return { text: null, rateLimited: false, error: 'gemini-cli: unexpected result shape' };
  }
  const r = parsed.data;
  if (r.error) {
    const rateLimited =
      r.error.code === RATE_LIMIT_STATUS || RATE_LIMIT_PATTERN.test(r.error.message);
    return { text: null, rateLimited, error: `gemini-cli: ${r.error.message}` };
  }
  if (typeof r.response === 'string') {
    return { text: r.response, rateLimited: false, error: null };
  }
  return { text: null, rateLimited: false, error: 'gemini-cli: no response field' };
}

/**
 * Argument list for `gemini -p`. The CLI has no system-prompt flag, so the
 * system text is prepended to the prompt. Headless default approval mode
 * denies every tool; webTools pre-approves only the two web tools. An empty
 * model means "use the CLI's configured default".
 */
export function buildGeminiCliArgs(req: {
  system: string;
  user: string;
  model: string;
  webTools?: boolean;
}): string[] {
  const tools = req.webTools
    ? ['--allowed-tools', 'google_web_search', '--allowed-tools', 'web_fetch']
    : [];
  return [
    '--output-format', 'json',
    ...(req.model ? ['--model', req.model] : []),
    ...tools,
    '--prompt', `${req.system}\n\n${req.user}`,
  ];
}

/**
 * Argument list for `codex exec` (headless, ChatGPT subscription or
 * OPENAI_API_KEY). No system-prompt flag — the system text is prepended.
 * read-only sandbox keeps the agent away from the filesystem; --search
 * enables its web tools only when the request asks. Empty model = the CLI's
 * configured default.
 */
export function buildCodexCliArgs(req: {
  system: string;
  user: string;
  model: string;
  webTools?: boolean;
}): string[] {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    ...(req.model ? ['--model', req.model] : []),
    ...(req.webTools ? ['--search'] : []),
    `${req.system}\n\n${req.user}`,
  ];
}

/**
 * `codex exec --json` emits JSONL events. The reply is the last
 * agent-message event; error events carry a message. Two event shapes are
 * covered — `{item:{type:'agent_message',text}}` (current) and
 * `{msg:{type:'agent_message',message}}` (older builds) — parsed
 * defensively line by line.
 */
export function parseCodexCliOutput(raw: string): CliOutcome {
  let text: string | null = null;
  let error: string | null = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const e = event as {
      type?: string;
      message?: string;
      error?: { message?: string };
      item?: { type?: string; text?: string };
      msg?: { type?: string; message?: string };
    };
    if (e.item?.type === 'agent_message' && typeof e.item.text === 'string') {
      text = e.item.text;
    } else if (e.msg?.type === 'agent_message' && typeof e.msg.message === 'string') {
      text = e.msg.message;
    } else if (e.type === 'error' || e.type === 'turn.failed') {
      error = e.message ?? e.error?.message ?? 'unknown error';
    }
  }
  if (text !== null) return { text, rateLimited: false, error: null };
  if (error !== null) {
    return { text: null, rateLimited: RATE_LIMIT_PATTERN.test(error), error: `codex: ${error}` };
  }
  return { text: null, rateLimited: false, error: 'codex: no agent message in output' };
}

/**
 * Response of an OpenAI-compatible POST /chat/completions (OpenAI,
 * OpenRouter, Groq, local servers). Error shape is the OpenAI envelope.
 */
const OpenAiChatResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .optional(),
  error: z.object({ message: z.string() }).optional(),
});

export function parseOpenAiChatResponse(raw: string): CliOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { text: null, rateLimited: false, error: 'openai: response is not JSON' };
  }
  const parsed = OpenAiChatResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { text: null, rateLimited: false, error: 'openai: unexpected response shape' };
  }
  if (parsed.data.error) {
    const message = parsed.data.error.message;
    return { text: null, rateLimited: RATE_LIMIT_PATTERN.test(message), error: `openai: ${message}` };
  }
  const content = parsed.data.choices?.[0]?.message.content;
  if (typeof content === 'string') return { text: content, rateLimited: false, error: null };
  return { text: null, rateLimited: false, error: 'openai: empty completion' };
}
