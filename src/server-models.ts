import { z } from 'zod';
import type { MessageKey } from './i18n/catalog';
import { t } from './i18n/t';

/*
 * The models a model server offers (TASKS S3): `GET {base}/models` on an
 * OpenAI-compatible server, `GET {root}/api/tags` on Ollama (ADR 0057) —
 * asked by the engine's Test, by the engine probe when the server is on this
 * machine (ai-runtime.ts) and by the wizard's local-model card. What it
 * answered is kept in memory for the model fields' suggestions; a restart
 * forgets it until the next ask. Nothing here spends AI.
 */

const LIST_TIMEOUT_MS = 5_000;
/** A server on this machine that has not answered in this long is not running. */
export const LOCAL_LIST_TIMEOUT_MS = 1_500;
/** A bound on what one answer may put in memory; an aggregator lists a few hundred. */
const MAX_MODELS = 500;
/** Servers remembered for the suggestions — the stored one, and what the wizard found. */
const MAX_KNOWN_SERVERS = 8;

/**
 * Where the two common local servers listen out of the box (TASKS S1), and
 * the engine each is used through: Ollama through its own API (the local
 * engine, ADR 0057), LM Studio through its OpenAI-compatible one. The second
 * host is the machine itself as a container sees it (Docker Desktop; on
 * Linux, compose's `host-gateway`).
 */
const LOCAL_SERVERS = [
  { name: 'Ollama', port: 11434, engine: 'local_api', path: '' },
  { name: 'LM Studio', port: 1234, engine: 'openai_api', path: '/v1' },
] as const;
const LOCAL_HOSTS = ['127.0.0.1', 'host.docker.internal'] as const;

/** Names that serve embeddings, speech or ranking, not chat — never picked for the user. */
const NOT_A_CHAT_MODEL = /embed|minilm|rerank|whisper|\bbge\b|\btts\b/i;

const ModelListSchema = z.object({ data: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough();
const OllamaTagsSchema = z.object({ models: z.array(z.object({ name: z.string() }).passthrough()) }).passthrough();

/** `{ data: [{ id }] }` → the ids, sorted, at most MAX_MODELS; anything else → null. */
export function parseModelList(raw: unknown): string[] | null {
  const parsed = ModelListSchema.safeParse(raw);
  if (!parsed.success) return null;
  return [...new Set(parsed.data.data.map((m) => m.id.trim()).filter((id) => id.length > 0))].sort().slice(0, MAX_MODELS);
}

const known = new Map<string, string[]>();

/** The models the last list of this server named; [] when it was never asked. */
export function knownModels(base: string): string[] {
  return known.get(base) ?? [];
}

/** `{ models: [{ name }] }` from Ollama's /api/tags → the names, as parseModelList reads a /models answer. */
export function parseOllamaTags(raw: unknown): string[] | null {
  const parsed = OllamaTagsSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parseModelList({ data: parsed.data.models.map((m) => ({ id: m.name })) });
}

/** Whether the server's list names `model` — Ollama answers "llama3.1" with its ":latest" tag. */
export function listsModel(models: readonly string[], model: string): boolean {
  return models.includes(model) || models.includes(`${model}:latest`);
}

/** The model to offer first: the first that is not an embedding or speech model, else the first. */
export function preferredModel(models: readonly string[]): string | null {
  return models.find((m) => !NOT_A_CHAT_MODEL.test(m)) ?? models[0] ?? null;
}

export interface LocalServer {
  name: string;
  /** The engine it is used through, and the address that engine takes: Ollama's root, LM Studio's /v1. */
  engine: 'local_api' | 'openai_api';
  base: string;
  models: string[];
}

/**
 * The local servers answering at their default addresses, with what they run
 * — one request per address, all at once, so the wizard waits at most
 * LOCAL_LIST_TIMEOUT_MS. A server found on both hosts is listed once.
 */
export async function findLocalServers(): Promise<LocalServer[]> {
  const candidates = LOCAL_SERVERS.flatMap((s) =>
    LOCAL_HOSTS.map((h) => ({ name: s.name, engine: s.engine, base: `http://${h}:${s.port}${s.path}` })),
  );
  const answers = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      listed: await (c.engine === 'local_api' ? listOllamaModels(c.base, LOCAL_LIST_TIMEOUT_MS) : listServerModels(c.base, undefined, LOCAL_LIST_TIMEOUT_MS)),
    })),
  );
  const found: LocalServer[] = [];
  for (const a of answers) {
    if ('models' in a.listed && !found.some((f) => f.name === a.name)) found.push({ name: a.name, engine: a.engine, base: a.base, models: a.listed.models });
  }
  return found;
}

/** Asks an OpenAI-compatible server for its models. The reason is a sentence for the flash when it could not. */
export async function listServerModels(
  base: string,
  apiKey: string | undefined,
  timeoutMs = LIST_TIMEOUT_MS,
): Promise<{ models: string[] } | { reason: string }> {
  return listModels(`${base}/models`, base, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, parseModelList, timeoutMs, (status) =>
    // "http://127.0.0.1:11434" instead of ".../v1" is the usual slip; the address is saved as typed.
    status === 404 && new URL(base).pathname === '/' ? 'engine.models.httpTryV1' : 'engine.models.http',
  );
}

/** Asks Ollama at its root for the models it has pulled (ADR 0057). */
export async function listOllamaModels(root: string, timeoutMs = LIST_TIMEOUT_MS): Promise<{ models: string[] } | { reason: string }> {
  return listModels(`${root}/api/tags`, root, {}, parseOllamaTags, timeoutMs, (status) =>
    status === 404 ? 'engine.models.httpNotOllama' : 'engine.models.http',
  );
}

async function listModels(
  url: string,
  base: string,
  headers: Record<string, string>,
  parse: (raw: unknown) => string[] | null,
  timeoutMs: number,
  /** The sentence for a refusal: the status alone, or with the usual slip behind it named. */
  refusal: (status: number) => MessageKey,
): Promise<{ models: string[] } | { reason: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers, signal: ctrl.signal });
    if (!resp.ok) return { reason: t(refusal(resp.status), { url, status: resp.status, base }) };
    const models = parse(await resp.json().catch(() => null));
    if (models === null) return { reason: t('engine.models.notAList', { url }) };
    if (!known.has(base) && known.size >= MAX_KNOWN_SERVERS) known.clear();
    known.set(base, models);
    return { models };
  } catch {
    return { reason: t('engine.models.noAnswer', { base }) };
  } finally {
    clearTimeout(timer);
  }
}
