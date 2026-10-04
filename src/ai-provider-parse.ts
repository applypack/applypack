import { z } from 'zod';
import type { AiProviderId } from './ai-engine';
import { addUsage, count, NO_USAGE, type AiOutcome, type AiSpend, type AiUsage } from './ai-usage';
import { retryAfterMs } from './http';
import { maskToken } from './text-utils';

/** The Messages API's `usage` block, as the API and the Claude Code CLI report it. */
const AnthropicUsageSchema = z.object({
  input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().nullable().optional(),
  cache_read_input_tokens: z.number().nullable().optional(),
  // The write split by lifetime; the CLI on a plan writes for an hour (×2 input).
  cache_creation: z
    .object({ ephemeral_5m_input_tokens: z.number().optional(), ephemeral_1h_input_tokens: z.number().optional() })
    .nullable()
    .optional(),
  output_tokens: z.number().optional(),
  output_tokens_details: z.object({ thinking_tokens: z.number().optional() }).nullable().optional(),
  server_tool_use: z.object({ web_search_requests: z.number().optional() }).nullable().optional(),
});
type AnthropicUsage = z.infer<typeof AnthropicUsageSchema>;

/**
 * An Anthropic `usage` block as the ledger's fields (ADR 0055). `input_tokens`
 * is already the uncached part; `output_tokens` already counts the thinking.
 * Without the lifetime split, a cache write is priced as a five-minute one.
 */
export function anthropicUsage(u: AnthropicUsage | null | undefined): AiUsage {
  if (!u) return NO_USAGE;
  const split = u.cache_creation;
  const w5 = count(split?.ephemeral_5m_input_tokens);
  const w1h = count(split?.ephemeral_1h_input_tokens);
  return {
    inputTokens: count(u.input_tokens),
    cacheWriteTokens: w5 !== null || w1h !== null ? w5 : count(u.cache_creation_input_tokens),
    cacheWrite1hTokens: w1h,
    cacheReadTokens: count(u.cache_read_input_tokens),
    outputTokens: count(u.output_tokens),
    webSearches: count(u.server_tool_use?.web_search_requests),
  };
}

/**
 * Shape of `claude -p --output-format json`. Only the fields we act on are
 * declared. Success and error results alike carry `usage`, `total_cost_usd`
 * and `modelUsage` (the CLI's own estimate, from its bundled price table).
 * Kept SDK-free so the parser can be unit-tested.
 */
const ClaudeCodeResultSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  api_error_status: z.number().nullable().optional(),
  duration_api_ms: z.number().optional(),
  num_turns: z.number().optional(),
  total_cost_usd: z.number().optional(),
  usage: AnthropicUsageSchema.optional(),
  modelUsage: z.record(z.string(), z.object({ outputTokens: z.number().optional() }).passthrough()).optional(),
});

/** What one CLI call spent — logged per call, so a slow call, a throttled call and a thinking call stop looking alike (#168). */
export interface CliUsage {
  apiMs?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  turns?: number;
}

export interface CliOutcome {
  text: string | null;
  /** True for 429 / overloaded / quota — the caller may retry later. */
  rateLimited: boolean;
  error: string | null;
  usage?: CliUsage;
  /** What the call spent, when the output says (ADR 0055) — on a failure too: a cut-off reply was billed. */
  spend?: AiSpend;
  /** How a failure ended, when the output tells a cut-off or a refusal from an error. */
  outcome?: AiOutcome;
}

const RATE_LIMIT_STATUS = 429;
const RATE_LIMIT_PATTERN = /rate.?limit|usage limit|overloaded|resource.?exhausted|quota/i;

/*
 * How a failed call failed, read the same way on every path (H40, H41):
 *  - `auth`: the vendor turned the key or the sign-in away. Never retried;
 *    the chain moves on at once and leaves the engine alone until the
 *    credential changes (ai-cooldown.ts).
 *  - `quota`: a plan's or a key's allowance is used up. It does not clear in
 *    seconds, so it is not retried either.
 *  - `transient`: a rate limit, an overloaded or failing server. One more try
 *    after the wait the server asks for, when that wait is short.
 */
export type FailureKind = 'auth' | 'quota' | 'transient' | 'other';

const AUTH_STATUS = new Set([401, 403]);
// The sentences a CLI prints for a refused sign-in carry no status code.
const AUTH_PATTERN =
  /invalid.{0,16}(api.?key|token|credential)|incorrect api key|unauthori[sz]ed|authentication (failed|error|required)|not logged in|please run \/login|log ?in again|(oauth|access) token.{0,24}(expired|revoked|invalid)|set an auth method/i;
const QUOTA_PATTERN = /usage limit|quota|resource.?exhausted/i;
const TRANSIENT_STATUS = new Set([RATE_LIMIT_STATUS, 500, 502, 503, 504, 529]);
const TRANSIENT_PATTERN = /rate.?limit|overloaded|too many requests/i;

export function failureKind(status: number | null | undefined, message: string): FailureKind {
  if ((status != null && AUTH_STATUS.has(status)) || AUTH_PATTERN.test(message)) return 'auth';
  if (QUOTA_PATTERN.test(message)) return 'quota';
  if ((status != null && TRANSIENT_STATUS.has(status)) || TRANSIENT_PATTERN.test(message)) return 'transient';
  return 'other';
}

/** The ledger's word for a failure of that kind. */
export function failureOutcome(kind: FailureKind): AiOutcome {
  return kind === 'auth' ? 'unauthorized' : kind === 'other' ? 'error' : 'rate_limited';
}

/** The flash's sentence for a refused credential: what happened, and the one place to fix it. */
export function refusedReason(detail: string, what: 'key' | 'sign-in'): string {
  const fix = what === 'key' ? 'paste a new one on Settings → AI engine' : 'sign in again, or paste a token on Settings → AI engine';
  return `the ${what} was refused (${detail}) — ${fix}`;
}

/** The longest wait a vendor may ask for before one more try; a longer one goes to the next engine. */
const MAX_RETRY_WAIT_MS = 10_000;
/** The wait when the vendor names none. */
const DEFAULT_RETRY_WAIT_MS = 2_000;
/** A retry has to leave this much of the attempt's budget for the call itself. */
const MIN_RETRY_BUDGET_MS = 5_000;

/**
 * How long to wait before the one retry a transient failure gets, or null
 * for none: the server's own `retry-after-ms` / `Retry-After` when it sends
 * one, else two seconds — as long as that is short and the budget still has
 * room for the call after it.
 */
export function retryWait(header: (name: string) => string | null | undefined, remainingMs: number, now: number): number | null {
  const ms = Number(header('retry-after-ms'));
  const asked = Number.isFinite(ms) && ms > 0 ? ms : retryAfterMs(header('retry-after') ?? null, now);
  const wait = asked ?? DEFAULT_RETRY_WAIT_MS;
  return wait <= MAX_RETRY_WAIT_MS && remainingMs - wait >= MIN_RETRY_BUDGET_MS ? wait : null;
}

/** A CLI failure worth the one retry: a rate limit or an overloaded server, not a spent allowance or a refused sign-in. */
export function cliRetryable(out: CliOutcome): boolean {
  return out.rateLimited && failureKind(null, out.error ?? '') === 'transient';
}

const MAX_FAILURE_REASON = 200;
/*
 * Anything shaped like a credential. A CLI writes whatever it likes to
 * stderr, so the reason is scrubbed before it can reach a flash message.
 *
 * Two shapes were slipping past, and both arrive through the same
 * door: `openai_api` is "any server that speaks /chat/completions", so the
 * key in play is whatever that server issues, not OpenAI's own.
 *
 *  - An underscore instead of a hyphen. `sk-` was matched and `sk_` was not,
 *    which is Groq's `gsk_…` and every `sk_live_…` the shape is copied from.
 *  - `Bearer <token>`. A gateway that echoes the request's headers in its
 *    error body hands over the whole credential in a form no vendor prefix
 *    can catch.
 */
const KEY_SHAPED =
  /\b(?:[A-Za-z]{0,4}sk[-_][A-Za-z0-9._-]{8,}|AIza[A-Za-z0-9._-]{10,}|Bearer\s+[A-Za-z0-9._~+/-]{8,}=*)/g;

/**
 * `max_tokens` on the Messages API counts the thinking too, and the current
 * Claude models think by default — one comparison measured 6 078 thinking
 * tokens inside an 8 000 budget, and the JSON was cut off mid-string (#159).
 * The callers' budgets size the ANSWER; this adds the room the thinking
 * takes. A ceiling, not a spend: a model that does not think stops where it
 * always did. The cap is the SDK's own — above ~21 300 tokens a non-streaming
 * request is refused outright (10 minutes at 128k tokens/hour).
 */
export const ANTHROPIC_THINKING_HEADROOM_TOKENS = 8_000;
const ANTHROPIC_NONSTREAMING_MAX_TOKENS = 21_000;

export function anthropicMaxTokens(answerTokens: number): number {
  return Math.min(answerTokens + ANTHROPIC_THINKING_HEADROOM_TOKENS, ANTHROPIC_NONSTREAMING_MAX_TOKENS);
}

/**
 * The 2026-02-09 web tools filter their results through code execution, and
 * that needs programmatic tool calling — Opus 4.6+, Sonnet 4.6+ and their
 * successors. Haiku 4.5 (and anything older) answered 400 to the same request
 * (#161); the API's own escape hatch is to allow direct calls only, which is
 * the same tools without the filtering.
 */
const PROGRAMMATIC_TOOL_MODEL = /^claude-(opus-(4-[6-9]|5)|sonnet-(4-[6-9]|5)|fable|mythos)\b/;

export function webToolsDirectOnly(model: string): boolean {
  return !PROGRAMMATIC_TOOL_MODEL.test(model);
}

/**
 * Why a CLI child failed, without its command line: execFile's err.message
 * is `Command failed: <bin> <args…>` and the args ARE the prompt — a resume,
 * an applicant's text, the posting. The reason is read off stderr (where the
 * CLI states it), the exit code and the signal, never off the message.
 */
export function cliFailure(
  err: unknown,
  timeoutMs: number,
): { reason: string; log: { code?: string | number; signal?: string; stderr?: string } } {
  const e = (err ?? {}) as { code?: unknown; signal?: unknown; killed?: unknown; stderr?: unknown };
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim().slice(0, 500) : '';
  const log = {
    ...(typeof e.code === 'string' || typeof e.code === 'number' ? { code: e.code } : {}),
    ...(typeof e.signal === 'string' ? { signal: e.signal } : {}),
    ...(stderr ? { stderr } : {}),
  };
  if (e.code === 'ENOENT') return { reason: 'not found on PATH', log };
  if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { reason: 'the reply exceeded the 1 MiB output cap', log };
  // execFile sets `killed` when it pulled the plug itself (the timeout); a
  // signal it did not send came from outside — the OOM killer, a shutdown.
  if (e.killed === true) return { reason: `timed out after ${Math.round(timeoutMs / 1000)} s`, log };
  if (typeof e.signal === 'string' && typeof e.code !== 'number') return { reason: `ended by ${e.signal}`, log };
  if (stderr) return { reason: stderr, log };
  if (typeof e.code === 'number') return { reason: `exited with code ${e.code}`, log };
  return { reason: 'failed with no output', log };
}

/**
 * One-line, browser-safe rendering of a provider failure: masks credentials,
 * collapses whitespace and caps the length. ADR 0027 keeps keys out of the
 * browser, and that must not depend on what a CLI happened to print.
 */
export function describeAiFailure(reason: string): string {
  const oneLine = reason.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return 'no reason reported';
  const masked = oneLine.replace(KEY_SHAPED, maskToken);
  const capped =
    masked.length > MAX_FAILURE_REASON
      ? `${masked.slice(0, MAX_FAILURE_REASON).trimEnd()}…`
      : masked;
  // The caller owns the sentence, so it owns the full stop too — provider
  // messages usually end in one, and two in a row read like a typo.
  return capped.replace(/\.+$/, '');
}

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
  const spend: AiSpend = {
    usage: anthropicUsage(r.usage),
    model: mainModel(r.modelUsage),
    reportedUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null,
  };
  if (r.is_error || r.subtype !== 'success') {
    const message = r.result ?? r.subtype;
    const kind = failureKind(r.api_error_status, message);
    const rateLimited = kind !== 'auth' && (r.api_error_status === RATE_LIMIT_STATUS || RATE_LIMIT_PATTERN.test(message));
    const outcome: AiOutcome =
      kind === 'auth' ? 'unauthorized' : rateLimited ? 'rate_limited' : /max.?output.?tokens/i.test(message) ? 'cut_off' : 'error';
    return { text: null, rateLimited, error: `claude-code: ${message}`, spend, outcome };
  }
  return {
    text: r.result ?? '',
    rateLimited: false,
    error: null,
    spend,
    usage: {
      apiMs: r.duration_api_ms,
      outputTokens: r.usage?.output_tokens,
      thinkingTokens: r.usage?.output_tokens_details?.thinking_tokens,
      turns: r.num_turns,
    },
  };
}

/** The model that did the work: the one with the most output, when the CLI ran more than one. */
function mainModel(models: Record<string, { outputTokens?: number }> | undefined): string | null {
  const entries = Object.entries(models ?? {});
  if (entries.length === 0) return null;
  return entries.reduce((best, cur) => ((cur[1].outputTokens ?? 0) > (best[1].outputTokens ?? 0) ? cur : best))[0];
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

/**
 * `claude -p` turns extended thinking on, and on "copy this resume into JSON"
 * Haiku 4.5 spent ~19 000 thinking tokens for a 3 500-token answer — 227 s
 * where the same call answers in 34 s with the budget at zero, same structure
 * quality (#168). Every tool-free call gets the cap; the verify call keeps
 * the CLI's default, it reasons over search results.
 */
export const CLI_THINKING_CAP_ENV = 'MAX_THINKING_TOKENS';
/**
 * With thinking off, Opus 5 refuses an effort above `high` (400: "effort 'xhigh'
 * is not supported when thinking is disabled"), and the CLI reads the effort
 * from the user's own ~/.claude/settings.json — which a local install shares.
 * Found 2026-09-30: every cover letter failed on an owner's `effortLevel: xhigh`.
 * An older CLI ignores the variable; a flag would stop it with "unknown option".
 */
export const CLI_EFFORT_ENV = 'CLAUDE_CODE_EFFORT_LEVEL';
const CAPPED_EFFORT = 'high';

export function cliThinkingCap(webTools: boolean | undefined): Record<string, string> {
  return webTools ? {} : { [CLI_THINKING_CAP_ENV]: '0', [CLI_EFFORT_ENV]: CAPPED_EFFORT };
}

/**
 * Every claude_code call reads no CLAUDE.md and no auto-memory. Started in the
 * checkout (npm start), the CLI read the repo's CLAUDE.md and the project's
 * memory into every call: +53 000 tokens each, measured 2026-09-30, and a
 * resume scan that reported those instructions as an injection. The provider
 * also runs it in the temp folder; these close the folders above that one too.
 */
export const CLAUDE_CODE_ISOLATION_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
};

export const CLI_PROVIDER_ENV_KEYS: Partial<Record<AiProviderId, readonly string[]>> = {
  claude_code: ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', CLI_THINKING_CAP_ENV, CLI_EFFORT_ENV, ...Object.keys(CLAUDE_CODE_ISOLATION_ENV)],
  gemini_cli: [
    'GEMINI_API_KEY',
    'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_GENAI_USE_GCA',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
  ],
  agy_cli: [],
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
const GeminiTokensSchema = z.object({
  prompt: z.number().optional(),
  candidates: z.number().optional(),
  cached: z.number().optional(),
  thoughts: z.number().optional(),
});

const GeminiCliResultSchema = z.object({
  response: z.string().optional(),
  // Per model: `prompt` includes the cached tokens, `candidates` is the answer
  // and `thoughts` the thinking, billed as output (packages/core telemetry).
  stats: z
    .object({ models: z.record(z.string(), z.object({ tokens: GeminiTokensSchema.optional() }).passthrough()).optional() })
    .passthrough()
    .optional(),
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
  const spend = geminiSpend(r.stats?.models);
  if (r.error) {
    const status = typeof r.error.code === 'number' ? r.error.code : null;
    const kind = failureKind(status, r.error.message);
    const rateLimited = kind !== 'auth' && (status === RATE_LIMIT_STATUS || RATE_LIMIT_PATTERN.test(r.error.message));
    return {
      text: null,
      rateLimited,
      error: `gemini-cli: ${r.error.message}`,
      ...(kind === 'auth' && { outcome: 'unauthorized' as const }),
      ...(spend && { spend }),
    };
  }
  if (typeof r.response === 'string') {
    return { text: r.response, rateLimited: false, error: null, ...(spend && { spend }) };
  }
  return { text: null, rateLimited: false, error: 'gemini-cli: no response field', ...(spend && { spend }) };
}

/** The Gemini CLI's per-model token stats as one usage, named for the model that answered most. */
function geminiSpend(models: Record<string, { tokens?: z.infer<typeof GeminiTokensSchema> }> | undefined): AiSpend | undefined {
  const entries = Object.entries(models ?? {}).filter(([, m]) => m.tokens);
  if (entries.length === 0) return undefined;
  let prompt = 0;
  let cached = 0;
  let output = 0;
  for (const [, m] of entries) {
    prompt += count(m.tokens?.prompt) ?? 0;
    cached += count(m.tokens?.cached) ?? 0;
    output += (count(m.tokens?.candidates) ?? 0) + (count(m.tokens?.thoughts) ?? 0);
  }
  const main = entries.reduce((best, cur) => ((cur[1].tokens?.candidates ?? 0) > (best[1].tokens?.candidates ?? 0) ? cur : best))[0];
  return {
    usage: { ...NO_USAGE, inputTokens: Math.max(0, prompt - cached), cacheReadTokens: cached, outputTokens: output },
    model: main,
    reportedUsd: null,
  };
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
    // One argument, not two: yargs reads a separate value that opens with "-"
    // as the next flag and exits "Not enough arguments following: prompt"
    // (measured on 0.46.0). The `=` form keeps any text the value.
    `--prompt=${req.system}\n\n${req.user}`,
  ];
}

/**
 * Shape of `agy -p --output-format json`: success carries `response`,
 * failures an `error` string. Stats pass through untouched.
 */
const AgyTokensSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  thinking_tokens: z.number().optional(),
  cache_read_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
});

const AgyCliResultSchema = z.object({
  conversation_id: z.string().optional(),
  status: z.string().optional(),
  response: z.string().optional(),
  error: z.string().optional(),
  duration_seconds: z.number().optional(),
  num_turns: z.number().optional(),
  usage: AgyTokensSchema.optional(),
});

export function parseAgyCliOutput(raw: string): CliOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return { text: null, rateLimited: false, error: 'agy-cli: output is not JSON' };
    }
    try {
      json = JSON.parse(match[0]);
    } catch {
      return { text: null, rateLimited: false, error: 'agy-cli: output is not JSON' };
    }
  }

  const parsed = AgyCliResultSchema.safeParse(json);
  if (!parsed.success) {
    return { text: null, rateLimited: false, error: 'agy-cli: unexpected result shape' };
  }
  const r = parsed.data;
  const input = count(r.usage?.input_tokens) ?? 0;
  const cached = count(r.usage?.cache_read_tokens) ?? 0;
  const output = count(r.usage?.output_tokens) ?? 0;
  const spend: AiSpend = {
    usage: {
      ...NO_USAGE,
      inputTokens: Math.max(0, input - cached),
      cacheReadTokens: cached,
      outputTokens: output,
    },
    model: null,
    reportedUsd: null,
  };

  if (r.status === 'ERROR' || r.error) {
    const message = r.error || 'unknown error';
    const kind = failureKind(null, message);
    const rateLimited = kind !== 'auth' && RATE_LIMIT_PATTERN.test(message);
    return {
      text: null,
      rateLimited,
      error: `agy-cli: ${message}`,
      ...(kind === 'auth' && { outcome: 'unauthorized' as const }),
      spend,
    };
  }

  if (typeof r.response === 'string') {
    return {
      text: r.response,
      rateLimited: false,
      error: null,
      spend,
      usage: {
        apiMs: typeof r.duration_seconds === 'number' ? Math.round(r.duration_seconds * 1000) : undefined,
        outputTokens: count(r.usage?.output_tokens) ?? undefined,
        thinkingTokens: count(r.usage?.thinking_tokens) ?? undefined,
        turns: count(r.num_turns) ?? undefined,
      },
    };
  }

  return { text: null, rateLimited: false, error: 'agy-cli: no response field', spend };
}

/**
 * Argument list for `agy -p`. Headless default disables slash commands.
 * Empty model = CLI's configured default.
 */
export function buildAgyCliArgs(req: {
  system: string;
  user: string;
  model: string;
  webTools?: boolean;
}): string[] {
  return [
    '--output-format', 'json',
    '--disable-slash-commands',
    ...(req.model ? ['--model', req.model] : []),
    `--prompt=${req.system}\n\n${req.user}`,
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
    // PROMPT is a plain clap positional (no allow_hyphen_values): text opening
    // with "-" would be read as a flag, so option parsing ends first — as for
    // claude_code (gotcha 14).
    '--',
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
  let usage: AiUsage | null = null;
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
      usage?: { input_tokens?: unknown; cached_input_tokens?: unknown; output_tokens?: unknown };
    };
    // `input_tokens` includes the cached ones, OpenAI-style; `output_tokens`
    // includes the reasoning. One turn per call, but a resumed one would add.
    if (e.type === 'turn.completed' && e.usage) {
      const input = count(e.usage.input_tokens);
      const cached = count(e.usage.cached_input_tokens);
      const turn: AiUsage = {
        ...NO_USAGE,
        inputTokens: input === null ? null : Math.max(0, input - (cached ?? 0)),
        cacheReadTokens: cached,
        outputTokens: count(e.usage.output_tokens),
      };
      usage = usage ? addUsage(usage, turn) : turn;
    }
    if (e.item?.type === 'agent_message' && typeof e.item.text === 'string') {
      text = e.item.text;
    } else if (e.msg?.type === 'agent_message' && typeof e.msg.message === 'string') {
      text = e.msg.message;
    } else if (e.type === 'error' || e.type === 'turn.failed') {
      error = e.message ?? e.error?.message ?? 'unknown error';
    }
  }
  // Codex names no model in its events: the requested one, or the CLI's default, prices it.
  const spend = usage ? { spend: { usage, model: null, reportedUsd: null } } : {};
  if (text !== null) return { text, rateLimited: false, error: null, ...spend };
  if (error !== null) {
    const auth = failureKind(null, error) === 'auth';
    return {
      text: null,
      rateLimited: !auth && RATE_LIMIT_PATTERN.test(error),
      error: `codex: ${error}`,
      ...(auth && { outcome: 'unauthorized' as const }),
      ...spend,
    };
  }
  return { text: null, rateLimited: false, error: 'codex: no agent message in output', ...spend };
}


/**
 * Response of an OpenAI-compatible POST /chat/completions (OpenAI,
 * OpenRouter, Groq, local servers). Error shape is the OpenAI envelope.
 */
const OpenAiChatResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() }))
    .optional(),
  // `prompt_tokens` includes the cached ones; `completion_tokens` includes the
  // reasoning. OpenRouter adds `cost`: its own charge for the call, in USD.
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).nullable().optional(),
      cost: z.number().optional(),
    })
    .nullable()
    .optional(),
  error: z.object({ message: z.string() }).optional(),
});

function openAiSpend(r: z.infer<typeof OpenAiChatResponseSchema>): AiSpend | undefined {
  if (!r.usage) return undefined;
  const prompt = count(r.usage.prompt_tokens);
  const cached = count(r.usage.prompt_tokens_details?.cached_tokens);
  return {
    usage: {
      ...NO_USAGE,
      inputTokens: prompt === null ? null : Math.max(0, prompt - (cached ?? 0)),
      cacheReadTokens: cached,
      outputTokens: count(r.usage.completion_tokens),
    },
    model: r.model ?? null,
    reportedUsd: typeof r.usage.cost === 'number' ? r.usage.cost : null,
  };
}

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
  const spend = openAiSpend(parsed.data);
  const spent = spend ? { spend } : {};
  const choice = parsed.data.choices?.[0];
  // The Anthropic path reads stop_reason (gotcha 16); this is the same read
  // for every OpenAI-compatible server. A cut-off reply is not an answer, and
  // a filtered one is a refusal, not "no JSON object" (audit 2026-09-10, AI-3).
  if (choice?.finish_reason === 'length') return { text: null, rateLimited: false, error: 'openai: reply cut off at the token limit', outcome: 'cut_off', ...spent };
  if (choice?.finish_reason === 'content_filter') return { text: null, rateLimited: false, error: 'openai: the model declined this request', outcome: 'refused', ...spent };
  const content = choice?.message.content;
  if (typeof content === 'string' && content.trim().length > 0) return { text: content, rateLimited: false, error: null, ...spent };
  return { text: null, rateLimited: false, error: 'openai: empty completion', outcome: 'empty', ...spent };
}

/*
 * Ollama's own chat API, which the `local_api` engine speaks (ADR 0057). The
 * native route rather than /v1, because only it takes a context window per
 * request: the compatible route runs at the server's default window and cuts
 * a longer prompt from the START — which is where the rules are.
 */

/** The window a local model gets when the AI tab names none; the AI tab offers these. */
export const DEFAULT_LOCAL_CONTEXT_TOKENS = 16_384;
export const LOCAL_CONTEXT_CHOICES = [8_192, 16_384, 32_768, 65_536] as const;
/** The chat template's own tokens around the two messages. */
const CHAT_TEMPLATE_TOKENS = 64;
/** Room past the answer for a model that thinks first; a model that does not stops where it would have. */
const LOCAL_THINKING_HEADROOM_TOKENS = 4_096;

/**
 * A cautious count of the tokens a text becomes: about 3.5 characters a token
 * for Latin text and 1.5 for anything else, so a Cyrillic resume is not waved
 * through a window it overflows. Cautious on purpose — a refused call goes to
 * the next engine, a truncated one answers without its rules.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3.5 + other / 1.5);
}

/** What a call needs of the window: the prompt, the answer and the template. */
export function localBudgetTokens(system: string, user: string, maxTokens: number): number {
  return estimateTokens(system) + estimateTokens(user) + maxTokens + CHAT_TEMPLATE_TOKENS;
}

export function buildOllamaChatBody(req: {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  contextTokens: number;
  json?: boolean;
}): string {
  return JSON.stringify({
    model: req.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    // Streamed so the headers arrive at once: a reply sent whole after five
    // minutes of generation meets Node's own header timeout, whatever ours says.
    stream: true,
    // JSON mode where the caller parses JSON: a small model's usual failure is the syntax.
    ...(req.json && { format: 'json' }),
    options: { num_ctx: req.contextTokens, num_predict: req.maxTokens + LOCAL_THINKING_HEADROOM_TOKENS },
  });
}

const OllamaChunkSchema = z.object({
  model: z.string().optional(),
  message: z.object({ content: z.string().optional() }).passthrough().optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  error: z.string().optional(),
});

/** Ollama's `{"error": "…"}`, the body of a refused request or a line of a failed stream. */
export function ollamaError(raw: string): string | null {
  try {
    const parsed = OllamaChunkSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data.error ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * A streamed /api/chat reply, line by line: the content pieces joined, the
 * last line's counts and reason. A thinking block some models still inline
 * is dropped; `length` is a cut-off, as `max_tokens` is on the Messages API.
 */
export function parseOllamaStream(raw: string): CliOutcome {
  let content = '';
  let model: string | null = null;
  let done: z.infer<typeof OllamaChunkSchema> | null = null;
  let error: string | null = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const chunk = OllamaChunkSchema.safeParse(json);
    if (!chunk.success) continue;
    if (chunk.data.error) error = chunk.data.error;
    content += chunk.data.message?.content ?? '';
    model = chunk.data.model ?? model;
    if (chunk.data.done) done = chunk.data;
  }
  const spend: AiSpend | undefined = done
    ? { usage: { ...NO_USAGE, inputTokens: count(done.prompt_eval_count), outputTokens: count(done.eval_count) }, model, reportedUsd: null }
    : undefined;
  const spent = spend ? { spend } : {};
  if (error !== null) return { text: null, rateLimited: false, error: `ollama: ${error}`, ...spent };
  if (!done) return { text: null, rateLimited: false, error: 'ollama: the reply stopped before it ended', ...spent };
  if (done.done_reason === 'length') return { text: null, rateLimited: false, error: 'ollama: reply cut off at the token limit', outcome: 'cut_off', ...spent };
  const text = content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '');
  if (text.trim().length === 0) return { text: null, rateLimited: false, error: 'ollama: the model returned no text', outcome: 'empty', ...spent };
  return { text, rateLimited: false, error: null, ...spent };
}

