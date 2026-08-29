import { z } from 'zod';

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
 * denies every tool; webTools pre-approves only the two web tools.
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
    '--model', req.model,
    ...tools,
    '--prompt', `${req.system}\n\n${req.user}`,
  ];
}
