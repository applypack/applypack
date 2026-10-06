import type { AiProviderId } from './ai-engine';
import { t } from './i18n/t';

/*
 * What one AI attempt spent, and on whose money (ADR 0055). Pure: the
 * provider parsers fill these shapes from what each vendor reports, the
 * runtime writes them into the ledger, the pages read them back.
 *
 * The rule the whole module keeps: a number the vendor did not report is
 * null, never 0. A timed-out call has no usage; a local server has usage
 * and no price; neither is "free".
 */

/**
 * How an attempt ended. A cut-off, refused or empty reply was still billed;
 * `unauthorized` is a key or a sign-in the vendor turned away (H40).
 */
const AI_OUTCOMES = ['ok', 'rate_limited', 'timeout', 'cut_off', 'refused', 'empty', 'unauthorized', 'error'] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

/** Tokens as the vendor counted them; input is the UNCACHED part. */
export interface AiUsage {
  inputTokens: number | null;
  /** Written to the prompt cache for five minutes (Anthropic's default, ×1.25 input). */
  cacheWriteTokens: number | null;
  /** Written for an hour (×2 input) — the Claude Code CLI does this on a plan. */
  cacheWrite1hTokens: number | null;
  cacheReadTokens: number | null;
  /** Includes thinking / reasoning: every vendor bills it as output. */
  outputTokens: number | null;
  /** Server-side web searches, billed per search on top of tokens. */
  webSearches: number | null;
}

/** What one attempt spent: the usage, the model the vendor says ran, the vendor's own dollar figure. */
export interface AiSpend {
  usage: AiUsage;
  /** The resolved model id from the response, when it names one. */
  model: string | null;
  /** The vendor's or the CLI's own figure (OpenRouter's `usage.cost`, Claude Code's `total_cost_usd`). */
  reportedUsd: number | null;
}

export const NO_USAGE: AiUsage = {
  inputTokens: null,
  cacheWriteTokens: null,
  cacheWrite1hTokens: null,
  cacheReadTokens: null,
  outputTokens: null,
  webSearches: null,
};

/** A count off a vendor payload: a non-negative finite number, else "not reported". */
export function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** Two requests of one attempt (a paused web-search turn resumed) as one: a field stays null only when both are. */
export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  const sum = (x: number | null, y: number | null) => (x === null && y === null ? null : (x ?? 0) + (y ?? 0));
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    cacheWriteTokens: sum(a.cacheWriteTokens, b.cacheWriteTokens),
    cacheWrite1hTokens: sum(a.cacheWrite1hTokens, b.cacheWrite1hTokens),
    cacheReadTokens: sum(a.cacheReadTokens, b.cacheReadTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    webSearches: sum(a.webSearches, b.webSearches),
  };
}

/** True when the vendor reported any token count at all. */
export function hasUsage(usage: AiUsage): boolean {
  return Object.values(usage).some((v) => v !== null);
}

/**
 * Every AI call site, by the label it already passed for its log line — a
 * closed set, so a new call site does not compile until it is named here and
 * the ledger can say what it is (ADR 0055; the fence registry's pattern,
 * ADR 0022). The resume bench calls its provider directly and is not in the
 * ledger: it is a hand-run measurement, not the user's spend.
 */
const AI_FEATURES = [
  'classifier',
  'prefilter',
  'posting-extract',
  'posting-brief',
  'resume-scan',
  'resume-structure',
  'resume-match',
  'resume-match-fast',
  'resume-suggestions',
  'resume-rewrite',
  'resume-review',
  'cover-letter',
  'job-verify',
  'screening',
  'screening-compare',
  'screening-bench',
  'engine-test',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/**
 * Whose money an attempt spends, and so which total it joins. The three are
 * never added together (ADR 0055): a flat plan is not a bill, and a local
 * model costs nothing.
 *
 * - `billed`: a pay-per-token key — the Anthropic API, an OpenAI-compatible
 *   server on the internet, the Gemini CLI with a GEMINI_API_KEY.
 * - `plan`: a subscription login — Claude Code, Codex, the Gemini CLI on a
 *   Google account. The dollar figure is what the call would cost on the API.
 * - `local`: an OpenAI-compatible server on this machine or this network.
 */
export const AI_BILLING = ['billed', 'plan', 'local'] as const;
export type AiBilling = (typeof AI_BILLING)[number];

export interface BillingFacts {
  /** OPENAI_BASE_URL — decides whether openai_api is a vendor or a local server. */
  openAiBaseUrl: string;
  /** A Gemini API key resolves (pasted or in .env): the CLI bills it per token. */
  geminiKey: boolean;
}

export function billingOf(id: AiProviderId, facts: BillingFacts): AiBilling {
  switch (id) {
    case 'anthropic_api':
      return 'billed';
    case 'openai_api':
      return isLocalUrl(facts.openAiBaseUrl) ? 'local' : 'billed';
    case 'gemini_cli':
      return facts.geminiKey ? 'billed' : 'plan';
    case 'claude_code':
    case 'codex_cli':
    case 'agy_cli':
      return 'plan';
    case 'local_api':
      return 'local';
  }
}

/**
 * The address typed for the OpenAI-compatible engine (TASKS S1), made one we
 * send to: http(s), no trailing slash, and https unless the server is local —
 * a key must never cross the internet in the clear. A local server needs no
 * key at all.
 */
export function checkOpenAiBaseUrl(input: string): { ok: true; url: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: t('engine.url.notAddress') };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: t('engine.url.scheme') };
  }
  if (url.username || url.password) return { ok: false, reason: t('engine.url.noKey') };
  const clean = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  if (url.protocol === 'http:' && !isLocalUrl(clean)) {
    return { ok: false, reason: t('engine.url.https') };
  }
  return { ok: true, url: clean };
}

/**
 * The Ollama address typed for the local engine (ADR 0057): its root, on this
 * machine or the user's own network — the engine is called local because it
 * is. A pasted `/v1` or `/api` is dropped: the native API lives at the root.
 */
export function checkLocalAiUrl(input: string): { ok: true; url: string } | { ok: false; reason: string } {
  const checked = checkOpenAiBaseUrl(input);
  if (!checked.ok) return checked;
  if (!isLocalUrl(checked.url)) {
    return { ok: false, reason: t('engine.url.notLocal') };
  }
  return { ok: true, url: checked.url.replace(/\/(v1|api)$/, '') };
}

/**
 * An address that is this machine or a private network — Ollama, LM Studio,
 * llama.cpp's server. `host.docker.internal` is the host seen from a container.
 */
export function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'host.docker.internal') return true;
  // An IPv6 literal: loopback, link-local, unique-local.
  if (host.includes(':')) return host === '::1' || /^(fe80|fc|fd)/.test(host);
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
