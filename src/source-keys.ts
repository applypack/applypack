import { z } from 'zod';

/*
 * Credentials for the keyed job sources (stage 3e, ADR 0034): Adzuna's
 * app_id + app_key, France Travail's OAuth client id + secret. Stored in
 * AppSettings.sourceKeys the way engine keys are (ADR 0027), so they are
 * pasted on /settings instead of edited into .env; .env stays the fallback.
 * Pure — parsing and env resolution only; storing merges in SQL
 * (settings.ts). No I/O, no logging: a secret leaves this module only as a
 * return value, and `redactSecrets` exists because Adzuna's are query
 * parameters that an HTTP error message would otherwise repeat.
 */

/** Each keyed source's fields, and the .env variable each one mirrors. */
export const SOURCE_KEY_FIELDS = {
  ADZUNA: { app_id: 'ADZUNA_APP_ID', app_key: 'ADZUNA_APP_KEY' },
  FRANCETRAVAIL: { client_id: 'FRANCE_TRAVAIL_CLIENT_ID', client_secret: 'FRANCE_TRAVAIL_CLIENT_SECRET' },
} as const;

export type KeyedSource = keyof typeof SOURCE_KEY_FIELDS;

/** Every field name any keyed source uses. */
export type SourceKeyField = { [S in KeyedSource]: keyof (typeof SOURCE_KEY_FIELDS)[S] & string }[KeyedSource];

/** What is stored: a map of field → secret per source. Never rendered, never logged. */
export type SourceKeys = Partial<Record<KeyedSource, Partial<Record<string, string>>>>;

/** A pasted credential is one line; anything longer is a paste accident. */
export const MAX_SOURCE_KEY_LENGTH = 500;

export const KEYED_SOURCES = Object.keys(SOURCE_KEY_FIELDS) as KeyedSource[];

export function isKeyedSource(value: unknown): value is KeyedSource {
  return typeof value === 'string' && value in SOURCE_KEY_FIELDS;
}

export function isSourceKeyField(source: KeyedSource, field: unknown): field is SourceKeyField {
  return typeof field === 'string' && field in SOURCE_KEY_FIELDS[source];
}

const StoredSchema = z.record(z.string(), z.record(z.string(), z.string()));

/** Parses the raw AppSettings.sourceKeys JSON. Tolerant: drops unknown sources, fields, blanks and over-long entries. */
export function parseSourceKeys(raw: unknown): SourceKeys {
  const parsed = StoredSchema.safeParse(raw ?? {});
  if (!parsed.success) return {};
  const keys: SourceKeys = {};
  for (const [source, fields] of Object.entries(parsed.data)) {
    if (!isKeyedSource(source)) continue;
    const kept: Partial<Record<string, string>> = {};
    for (const [field, value] of Object.entries(fields)) {
      const secret = value.trim();
      if (!isSourceKeyField(source, field) || secret.length === 0 || secret.length > MAX_SOURCE_KEY_LENGTH) continue;
      kept[field] = secret;
    }
    if (Object.keys(kept).length > 0) keys[source] = kept;
  }
  return keys;
}

/** Where one field's value comes from — for UI copy, never the value. */
export type SourceKeyOrigin = 'db' | 'env' | 'none';

export function sourceKeyOrigin(
  source: KeyedSource,
  field: SourceKeyField,
  keys: SourceKeys,
  env: NodeJS.ProcessEnv = process.env,
): SourceKeyOrigin {
  if (keys[source]?.[field]) return 'db';
  const fromEnv = env[envVarOf(source, field)]?.trim();
  return fromEnv ? 'env' : 'none';
}

/**
 * Every field a source needs, the pasted value winning over .env per field;
 * null when any field is missing — a half credential is no credential.
 */
export function resolveSourceKeys(
  source: KeyedSource,
  keys: SourceKeys,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const field of Object.keys(SOURCE_KEY_FIELDS[source])) {
    const stored = keys[source]?.[field];
    const value = stored ?? env[envVarOf(source, field as SourceKeyField)]?.trim();
    if (!value) return null;
    out[field] = value;
  }
  return out;
}

export function envVarOf(source: KeyedSource, field: SourceKeyField): string {
  return (SOURCE_KEY_FIELDS[source] as Record<string, string>)[field] ?? '';
}

/**
 * Whether a keyed source can be used at all: every field it needs is
 * present, pasted or in `.env`. Until then the source is not offered
 * anywhere — no suggestion row, no entry in the add-company form — because
 * the user has not registered with that vendor and accepted its terms.
 */
export function sourceUnlocked(source: KeyedSource, keys: SourceKeys, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSourceKeys(source, keys, env) !== null;
}

/** The keyed sources ready to use, as the plain strings the UI and the suggester compare against. */
export function unlockedSources(keys: SourceKeys, env: NodeJS.ProcessEnv = process.env): string[] {
  return KEYED_SOURCES.filter((s) => sourceUnlocked(s, keys, env));
}

/** Thrown by a keyed fetcher with no credential; source health files it as `auth`. */
export class SourceKeyMissingError extends Error {
  constructor(sourceLabel: string) {
    super(`${sourceLabel}: no key — paste it on Settings → Sources`);
    this.name = 'SourceKeyMissingError';
  }
}

/** A message with every secret replaced — for anything that may be logged or stored. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join('***');
    out = out.split(encodeURIComponent(secret)).join('***');
  }
  return out;
}
