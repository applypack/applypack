import { z } from 'zod';

/*
 * Pure AI-engine resolution (ADR 0013 / 0014): which backends run the AI
 * calls, in which priority order, and with which model per backend per role.
 * The dashboard stores an ordered chain in AppSettings.aiEngine (JSON);
 * .env only seeds the default. No I/O — unit-tested (ai-engine.test.ts).
 */

export const AI_PROVIDER_IDS = [
  'anthropic_api',
  'claude_code',
  'gemini_cli',
  'openai_api',
  'codex_cli',
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic_api: 'Anthropic API',
  claude_code: 'Claude Code CLI',
  gemini_cli: 'Gemini CLI',
  openai_api: 'OpenAI-compatible API',
  codex_cli: 'Codex CLI',
};

/** Which backends can research the web (verification calls ask for it). */
export const PROVIDER_WEB_TOOLS: Record<AiProviderId, boolean> = {
  anthropic_api: true,
  claude_code: true,
  gemini_cli: true,
  openai_api: false,
  codex_cli: true,
};

/**
 * The crawler tokens each backend's vendor publishes (ADR 0036).
 *
 * A site's robots.txt binds this install through the engine it actually
 * runs: every description we fetch is read by THAT vendor's model, so a
 * `Disallow` aimed at that vendor's crawler is aimed at what we are about to
 * do. An install on Gemini is bound by `Google-Extended` and not by
 * `ClaudeBot`; an install on Codex by OpenAI's tokens and not by Google's.
 *
 * Measured 2026-09-04: binding on EVERY AI token instead refused 3 of 16
 * European companies whose robots.txt named only a scraper (Bytespider) or a
 * dataset crawler (CCBot) — neither of which is this project.
 *
 * `openai_api` is the loose one: the same slot serves api.openai.com and a
 * local model on localhost, and nothing in the config says which. It is
 * mapped to OpenAI's tokens because that is what the setting is named for,
 * and erring toward the vendor is the direction that asks for less.
 */
export const PROVIDER_AI_TOKENS: Record<AiProviderId, readonly string[]> = {
  anthropic_api: ['claudebot', 'claude-web', 'anthropic-ai'],
  claude_code: ['claudebot', 'claude-web', 'anthropic-ai'],
  gemini_cli: ['google-extended'],
  openai_api: ['gptbot', 'chatgpt-user', 'oai-searchbot'],
  codex_cli: ['gptbot', 'chatgpt-user', 'oai-searchbot'],
};

/** Every vendor token that binds an install running these engines, once each. */
export function aiCrawlerTokens(providers: readonly AiProviderId[]): string[] {
  return [...new Set(providers.flatMap((p) => PROVIDER_AI_TOKENS[p] ?? []))];
}

/** Metered billing — every call spends money (vs a flat subscription). */
export const PROVIDER_PAID: Record<AiProviderId, boolean> = {
  anthropic_api: true,
  claude_code: false,
  gemini_cli: false,
  openai_api: true,
  codex_cli: false,
};

export type AiRole = 'classifier' | 'resume' | 'cover';

/**
 * Curated per-family model ids for the dashboard selects. The empty string
 * means "the engine's own default" (CLI-configured model, or the built-in
 * default below). openai_api is free-text in the UI — with a custom base URL
 * (OpenRouter, Groq, local servers) any model id is legal.
 */
export const PROVIDER_MODEL_OPTIONS: Record<AiProviderId, string[]> = {
  anthropic_api: ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5'],
  claude_code: ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5'],
  gemini_cli: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  openai_api: [],
  codex_cli: ['gpt-5.1', 'gpt-5-mini'],
};

// Claude Code resolves these aliases in --model; the Messages API does not.
const CLAUDE_CODE_MODEL_ALIASES = new Set(['haiku', 'sonnet', 'opus']);

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** True when the model id plausibly belongs to the provider's family. */
export function modelFitsProvider(model: string, provider: AiProviderId): boolean {
  switch (provider) {
    case 'gemini_cli':
      return model.startsWith('gemini');
    case 'openai_api':
      // Base-URL providers (OpenRouter, Groq, local) use arbitrary ids.
      return model.length > 0;
    case 'codex_cli':
      return /^(gpt-|o\d|codex)/.test(model);
    case 'claude_code':
      return model.startsWith('claude') || CLAUDE_CODE_MODEL_ALIASES.has(model);
    case 'anthropic_api':
      return model.startsWith('claude');
  }
}

/** Stored shape of AppSettings.aiEngine — tolerant, unknowns dropped. */
const StoredEngineSchema = z.object({
  order: z.array(z.string()).default([]),
  models: z
    .record(
      z.string(),
      z.object({
        classifier: z.string().nullable().optional(),
        resume: z.string().nullable().optional(),
        cover: z.string().nullable().optional(),
      }),
    )
    .default({}),
});

export interface AiEngineConfig {
  order: AiProviderId[];
  models: Partial<
    Record<AiProviderId, { classifier?: string | null; resume?: string | null; cover?: string | null }>
  >;
}

/** Parses the raw JSON column; never throws, unknown ids are dropped. */
export function parseAiEngineConfig(raw: unknown): AiEngineConfig {
  const parsed = StoredEngineSchema.safeParse(raw ?? {});
  if (!parsed.success) return { order: [], models: {} };
  const order = parsed.data.order.filter(isAiProviderId);
  const models: AiEngineConfig['models'] = {};
  for (const [id, m] of Object.entries(parsed.data.models)) {
    if (isAiProviderId(id)) models[id] = m;
  }
  return { order: [...new Set(order)], models };
}

export interface AiEngineEnv {
  provider: AiProviderId;
  hasAnthropicKey: boolean;
  hasOpenAiKey: boolean;
  /** CLI auth is file/env detectable — false means calls cannot work yet. */
  geminiUsable: boolean;
  codexUsable: boolean;
  classifierModel: string;
  resumeModel: string;
  /** OPENAI_MODEL from .env, used when the openai_api slot is empty. */
  openAiModel: string;
}

/** Engines that certainly cannot complete a call on this host right now. */
export function providerUnusable(id: AiProviderId, env: AiEngineEnv): boolean {
  switch (id) {
    case 'anthropic_api':
      return !env.hasAnthropicKey;
    case 'openai_api':
      return !env.hasOpenAiKey;
    case 'gemini_cli':
      return !env.geminiUsable;
    case 'codex_cli':
      return !env.codexUsable;
    case 'claude_code':
      return false; // keychain auth is not detectable — let the call decide
  }
}

/**
 * Default model per backend per role when the slot is empty. '' means "let
 * the CLI use its own configured default" (the arg builders omit --model).
 */
export function defaultModelFor(id: AiProviderId, role: AiRole, env: AiEngineEnv): string {
  switch (id) {
    case 'anthropic_api':
    case 'claude_code':
      return role === 'classifier' ? env.classifierModel : env.resumeModel;
    case 'gemini_cli':
      return role === 'classifier' ? 'gemini-2.5-flash' : 'gemini-2.5-pro';
    case 'openai_api':
      return env.openAiModel;
    case 'codex_cli':
      return '';
  }
}

export interface ResolvedAiEngine {
  /** Usable engines in priority order — never empty. */
  chain: AiProviderId[];
  /** Engines the user enabled but this host cannot run yet. */
  skipped: AiProviderId[];
  modelFor(id: AiProviderId, role: AiRole): string;
}

/**
 * Merges the stored chain with the .env defaults. Unusable engines are
 * skipped (reported, so the UI can explain); an empty result falls back to
 * the .env provider and finally claude_code — the pipeline always has a
 * chain to try. Models outside the backend's family fall back per role.
 */
/** Shape of AppSettings.aiUsage: { "YYYY-MM-DD": { provider: { role: n } } }. */
const StoredUsageSchema = z.record(
  z.string(),
  z.record(z.string(), z.record(z.string(), z.number())),
);

export interface AiUsageRow {
  id: AiProviderId;
  classifier: number;
  resume: number;
  cover: number;
}

/** Sums the per-day counters over the last `days` days; busiest first. */
export function summarizeAiUsage(raw: unknown, days: number, today: Date): AiUsageRow[] {
  const parsed = StoredUsageSchema.safeParse(raw ?? {});
  if (!parsed.success) return [];
  const window = new Set<string>();
  for (let i = 0; i < days; i++) {
    window.add(new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const totals = new Map<AiProviderId, { classifier: number; resume: number; cover: number }>();
  for (const [day, providers] of Object.entries(parsed.data)) {
    if (!window.has(day)) continue;
    for (const [id, roles] of Object.entries(providers)) {
      if (!isAiProviderId(id)) continue;
      const row = totals.get(id) ?? { classifier: 0, resume: 0, cover: 0 };
      row.classifier += roles.classifier ?? 0;
      row.resume += roles.resume ?? 0;
      row.cover += roles.cover ?? 0;
      totals.set(id, row);
    }
  }
  return [...totals.entries()]
    .map(([id, r]) => ({ id, ...r }))
    .filter((r) => r.classifier + r.resume + r.cover > 0)
    .sort((a, b) => b.classifier + b.resume + b.cover - (a.classifier + a.resume + a.cover));
}

export function resolveAiEngine(raw: unknown, env: AiEngineEnv): ResolvedAiEngine {
  const config = parseAiEngineConfig(raw);
  const wanted = config.order.length > 0 ? config.order : [env.provider];
  const chain = wanted.filter((id) => !providerUnusable(id, env));
  const skipped = wanted.filter((id) => providerUnusable(id, env));
  if (chain.length === 0) {
    chain.push(providerUnusable(env.provider, env) ? 'claude_code' : env.provider);
  }
  return {
    chain,
    skipped,
    modelFor(id, role) {
      // An empty "cover" slot inherits the resume one: the extra role costs
      // nothing until someone deliberately points it at another model.
      const slots: AiRole[] = role === 'cover' ? ['cover', 'resume'] : [role];
      for (const slot of slots) {
        const stored = config.models[id]?.[slot]?.trim();
        if (stored && modelFitsProvider(stored, id)) return stored;
      }
      return defaultModelFor(id, role === 'cover' ? 'resume' : role, env);
    },
  };
}
