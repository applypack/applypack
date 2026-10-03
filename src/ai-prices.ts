import { hasUsage, type AiUsage } from './ai-usage';

/*
 * What a model's tokens cost, from the vendors' published price pages
 * (ADR 0055). Pure. Every price is USD per million tokens, which is also
 * micro-dollars per token, so a cost is an integer sum with no float drift.
 *
 * Read on the date below from:
 *  - https://platform.claude.com/docs/en/about-claude/pricing
 *  - https://developers.openai.com/api/docs/pricing (standard tier)
 *  - https://ai.google.dev/gemini-api/docs/pricing (paid tier, text)
 *
 * A price change is a new date and new rows — a stored call keeps the date
 * that priced it, so history is never re-priced. A model missing here is
 * "not priced", never $0: the page says so and names this date.
 */
export const PRICES_AS_OF = '2026-09-28';

export interface ModelPrice {
  input: number;
  /** Five-minute cache write (Anthropic ×1.25); vendors without write pricing charge input. */
  cacheWrite: number;
  /** One-hour cache write (Anthropic ×2). */
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  /** Micro-dollars per server-side web search; web fetch is free. */
  perSearch?: number;
  /** Gemini Pro charges more for a prompt over a size, every token of the call. */
  longContext?: { above: number; input: number; cacheRead: number; output: number };
}

/** Anthropic's web search: $10 per 1,000 searches, the same on every model. */
const ANTHROPIC_SEARCH = 10_000;

function anthropic(input: number, cacheRead: number, output: number): ModelPrice {
  return { input, cacheWrite: input * 1.25, cacheWrite1h: input * 2, cacheRead, output, perSearch: ANTHROPIC_SEARCH };
}

/** OpenAI and Gemini cache on their own and do not bill a write. */
function noWrite(input: number, cacheRead: number, output: number): ModelPrice {
  return { input, cacheWrite: input, cacheWrite1h: input, cacheRead, output };
}

const PRICES: Record<string, ModelPrice> = {
  // Anthropic — cache reads are 0.1× input, 0.05× on Opus 5.5, 0.025× on Fable 5.1.
  'claude-fable-5-1': anthropic(10, 0.25, 50),
  'claude-fable-5': anthropic(10, 1, 50),
  'claude-opus-5-5': anthropic(4, 0.2, 20),
  'claude-opus-5': anthropic(5, 0.5, 25),
  'claude-opus-4-8': anthropic(5, 0.5, 25),
  'claude-opus-4-7': anthropic(5, 0.5, 25),
  'claude-opus-4-6': anthropic(5, 0.5, 25),
  'claude-opus-4-5': anthropic(5, 0.5, 25),
  'claude-sonnet-5': anthropic(2, 0.2, 10),
  'claude-sonnet-4-6': anthropic(3, 0.3, 15),
  'claude-sonnet-4-5': anthropic(3, 0.3, 15),
  'claude-haiku-4-5': anthropic(1, 0.1, 5),
  // OpenAI, standard tier — reasoning tokens are billed as output.
  'gpt-5.5': noWrite(5, 0.5, 30),
  'gpt-5.2': noWrite(1.75, 0.175, 14),
  'gpt-5.1': noWrite(1.25, 0.125, 10),
  'gpt-5': noWrite(1.25, 0.125, 10),
  'gpt-5-mini': noWrite(0.25, 0.025, 2),
  'gpt-5-nano': noWrite(0.05, 0.005, 0.4),
  'gpt-4.1': noWrite(2, 0.5, 8),
  'gpt-4.1-mini': noWrite(0.4, 0.1, 1.6),
  'gpt-4o': noWrite(2.5, 1.25, 10),
  'gpt-4o-mini': noWrite(0.15, 0.075, 0.6),
  o3: noWrite(2, 0.5, 8),
  'o4-mini': noWrite(1.1, 0.275, 4.4),
  // Google, paid tier, text — output includes thinking.
  'gemini-3.8-flash-high': noWrite(0.3, 0.03, 2.5),
  'gemini-3.1-pro-high': { ...noWrite(1.25, 0.125, 10), longContext: { above: 200_000, input: 2.5, cacheRead: 0.25, output: 15 } },
  'gemini-2.5-pro': { ...noWrite(1.25, 0.125, 10), longContext: { above: 200_000, input: 2.5, cacheRead: 0.25, output: 15 } },
  'gemini-2.5-flash': noWrite(0.3, 0.03, 2.5),
};

/**
 * The key a model id is priced under: lower case, without the date a vendor
 * pins a snapshot with (`claude-haiku-4-5-20251001`, `gpt-5-mini-2025-08-07`)
 * or the context tag Claude Code appends (`…[1m]`). Anything else — a
 * `-codex` variant, a provider prefix on OpenRouter — stays and is unpriced,
 * because a near name is not the same price.
 */
export function canonicalModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, '');
}

export function priceOf(model: string | null): ModelPrice | null {
  return model ? (PRICES[canonicalModel(model)] ?? null) : null;
}

/**
 * The attempt's cost in micro-dollars, or null: a model this table does not
 * know, or an attempt the vendor reported no usage for (a timeout). Rounded
 * once, at the end.
 */
export function costMicroUsd(model: string | null, usage: AiUsage): number | null {
  const price = priceOf(model);
  if (!price || !hasUsage(usage)) return null;
  const prompt =
    (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.cacheWrite1hTokens ?? 0);
  const rate = price.longContext && prompt > price.longContext.above ? { ...price, ...price.longContext } : price;
  const micro =
    (usage.inputTokens ?? 0) * rate.input +
    (usage.cacheWriteTokens ?? 0) * rate.cacheWrite +
    (usage.cacheWrite1hTokens ?? 0) * rate.cacheWrite1h +
    (usage.cacheReadTokens ?? 0) * rate.cacheRead +
    (usage.outputTokens ?? 0) * rate.output +
    (usage.webSearches ?? 0) * (rate.perSearch ?? 0);
  return Math.round(micro);
}

/** Every model id the table prices — for the completeness test against the engine options. */
export function pricedModels(): string[] {
  return Object.keys(PRICES);
}
