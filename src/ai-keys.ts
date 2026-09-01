import { z } from 'zod';
import { AI_PROVIDER_IDS, type AiProviderId } from './ai-engine';

/*
 * Per-engine credentials (ADR 0027): the key an engine needs, stored in
 * AppSettings.aiKeys so a non-technical user can paste it into the dashboard
 * instead of editing .env. Pure — parsing, merging and env resolution only;
 * the row itself is read and written through settings.ts. No I/O, no logging:
 * a secret must never leave this module by any path but its return value.
 */

/**
 * The .env variable each engine's key mirrors — also the variable name the
 * CLI backends read from their child environment. Engines missing here take
 * no key at all (codex_cli authenticates with `codex login`).
 */
export const AI_KEY_ENV_VARS = {
  anthropic_api: 'ANTHROPIC_API_KEY',
  claude_code: 'CLAUDE_CODE_OAUTH_TOKEN',
  gemini_cli: 'GEMINI_API_KEY',
  openai_api: 'OPENAI_API_KEY',
} as const satisfies Partial<Record<AiProviderId, string>>;

export type AiKeyProviderId = keyof typeof AI_KEY_ENV_VARS;

/** Resolved secrets per engine — never rendered, never logged. */
export type AiKeys = Partial<Record<AiKeyProviderId, string>>;

// A pasted credential is a single line; anything longer is a paste accident
// (a whole .env file, a PEM block) that would bloat the settings row.
export const MAX_AI_KEY_LENGTH = 500;

export function providerTakesKey(id: AiProviderId): id is AiKeyProviderId {
  return id in AI_KEY_ENV_VARS;
}

/** Engines that accept a pasted key, in the roster's own order. */
export const AI_KEY_PROVIDER_IDS: AiKeyProviderId[] = AI_PROVIDER_IDS.filter(providerTakesKey);

const StoredKeysSchema = z.record(z.string(), z.string());

/**
 * Parses the raw AppSettings.aiKeys JSON. Tolerant like the engine config:
 * never throws, drops unknown ids and blanks, so a hand-edited row cannot
 * put a non-string where a secret is expected.
 */
export function parseAiKeys(raw: unknown): AiKeys {
  const parsed = StoredKeysSchema.safeParse(raw ?? {});
  if (!parsed.success) return {};
  const keys: AiKeys = {};
  for (const [id, value] of Object.entries(parsed.data)) {
    const key = value.trim().slice(0, MAX_AI_KEY_LENGTH);
    if (key.length > 0 && providerTakesKey(id as AiProviderId)) keys[id as AiKeyProviderId] = key;
  }
  return keys;
}

/** Stores a pasted key, or removes it when the value is blank. */
export function withAiKey(keys: AiKeys, id: AiKeyProviderId, value: string): AiKeys {
  const next = { ...keys };
  const key = value.trim().slice(0, MAX_AI_KEY_LENGTH);
  if (key.length === 0) delete next[id];
  else next[id] = key;
  return next;
}

/**
 * The credential an engine uses for one call: the pasted key wins, `.env` is
 * the fallback. That order is the whole point — a .env deployment keeps
 * working untouched, and pasting a key overrides it without a restart.
 */
export function resolveAiKey(
  id: AiProviderId,
  keys: AiKeys,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!providerTakesKey(id)) return undefined;
  const stored = keys[id];
  if (stored) return stored;
  const fromEnv = env[AI_KEY_ENV_VARS[id]]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/** Where an engine's credential comes from — for UI copy, never the value. */
export type AiKeySource = 'db' | 'env' | 'none';

export function aiKeySource(
  id: AiProviderId,
  keys: AiKeys,
  env: NodeJS.ProcessEnv = process.env,
): AiKeySource {
  if (!providerTakesKey(id)) return 'none';
  if (keys[id]) return 'db';
  return resolveAiKey(id, {}, env) ? 'env' : 'none';
}
