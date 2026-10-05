import { z } from 'zod';
import { AI_TASKS, type AiTask } from './ai-tasks';

/*
 * Pure AI-engine resolution (ADR 0013 / 0014): which backends run the AI
 * calls, in which priority order, with which model per backend per role, and
 * which tasks each backend takes (ADR 0060). The dashboard stores an ordered
 * chain in AppSettings.aiEngine (JSON); .env only seeds the default. No I/O —
 * unit-tested (ai-engine.test.ts).
 */

export const AI_PROVIDER_IDS = [
  'anthropic_api',
  'claude_code',
  'gemini_cli',
  'agy_cli',
  'openai_api',
  'codex_cli',
  'local_api',
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic_api: 'Anthropic API',
  claude_code: 'Claude Code CLI',
  gemini_cli: 'Gemini CLI',
  agy_cli: 'Antigravity CLI (agy)',
  openai_api: 'OpenAI-compatible API',
  codex_cli: 'Codex CLI',
  local_api: 'Local model (Ollama)',
};

/** Which backends can research the web (verification calls ask for it). */
const PROVIDER_WEB_TOOLS: Record<AiProviderId, boolean> = {
  anthropic_api: true,
  claude_code: true,
  gemini_cli: true,
  agy_cli: false,
  openai_api: false,
  codex_cli: true,
  local_api: false,
};

/** A call that searches the web goes to the engines that can, while the chain holds one (ADR 0009). */
export function preferWebTools(chain: readonly AiProviderId[]): AiProviderId[] {
  const capable = chain.filter((id) => PROVIDER_WEB_TOOLS[id]);
  return capable.length > 0 ? capable : [...chain];
}

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
 * `openai_api` serves api.openai.com and a server on this machine alike: it
 * carries OpenAI's tokens, and `aiCrawlerTokens` drops them when its address
 * is local. `local_api` is a model on this machine by construction — its
 * address must be local (ai-usage.ts:checkLocalAiUrl) — and is nobody's
 * crawler (ADR 0036 addendum 2026-09-28).
 *
 * Anthropic publishes three names (support.claude.com, read 2026-09-16):
 * `ClaudeBot`, `Claude-User` and `Claude-SearchBot`. `Claude-Web` and
 * `anthropic-ai` are older names it no longer lists. They stay, because a
 * robots.txt that still names them is still talking about Anthropic.
 */
const PROVIDER_AI_TOKENS: Record<AiProviderId, readonly string[]> = {
  anthropic_api: ['claudebot', 'claude-user', 'claude-searchbot', 'claude-web', 'anthropic-ai'],
  claude_code: ['claudebot', 'claude-user', 'claude-searchbot', 'claude-web', 'anthropic-ai'],
  gemini_cli: ['google-extended'],
  agy_cli: ['google-extended'],
  openai_api: ['gptbot', 'chatgpt-user', 'oai-searchbot'],
  codex_cli: ['gptbot', 'chatgpt-user', 'oai-searchbot'],
  local_api: [],
};

/**
 * Every vendor token that binds an install running these engines, once each.
 * An OpenAI-compatible engine pointed at a local server is no vendor's
 * crawler, so it binds nothing (ADR 0036 addendum 2026-09-28).
 */
export function aiCrawlerTokens(providers: readonly AiProviderId[], hosts: Partial<Pick<AiEngineEnv, 'openAiLocal'>> = {}): string[] {
  return [...new Set(providers.flatMap((p) => (p === 'openai_api' && hosts.openAiLocal ? [] : PROVIDER_AI_TOKENS[p] ?? [])))];
}

/**
 * The engines whose tokens bind this install: every one that may read what we
 * fetch, not only what runs this minute. That is the list with its skipped
 * engines (a login tomorrow puts them back in front), the last resort `chain`
 * holds while nothing in the list can run, and the .env engine an emptied list
 * falls back to — except on a local-only install: every engine in the list a
 * server on this machine and none of them skipped. Nothing else reads what it
 * fetches until the list changes, and the list is read again on the next run.
 */
export function bindingProviders(
  engine: ResolvedAiEngine,
  provider: AiProviderId,
  hosts: Partial<Pick<AiEngineEnv, 'openAiLocal'>> = {},
): AiProviderId[] {
  const local = (id: AiProviderId) => id === 'local_api' || (id === 'openai_api' && hosts.openAiLocal === true);
  if (engine.lastResort === null && engine.skipped.length === 0 && engine.chain.every(local)) return [];
  return [...new Set([...engine.chain, ...engine.skipped, provider])];
}

export type AiRole = 'classifier' | 'resume' | 'cover';

/**
 * Curated per-family model ids for the dashboard selects. The empty string
 * means "the engine's own default" (CLI-configured model, or the built-in
 * default below). openai_api and local_api are free text in the UI — a
 * custom base URL (OpenRouter, Groq, a local server) takes any model id, and
 * the fields suggest what the server itself lists.
 */
export const PROVIDER_MODEL_OPTIONS: Record<AiProviderId, string[]> = {
  anthropic_api: ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5'],
  claude_code: ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5'],
  gemini_cli: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  agy_cli: ['gemini-3.8-flash-high', 'gemini-3.1-pro-high', 'claude-sonnet-4-6'],
  openai_api: [],
  codex_cli: ['gpt-5.1', 'gpt-5-mini'],
  local_api: [],
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
    case 'agy_cli':
      return /^(gemini|claude|gpt)/.test(model);
    case 'openai_api':
    case 'local_api':
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
  // Read entry by entry below: one malformed list must not cost the user their engine order.
  tasks: z.record(z.string(), z.unknown()).catch({}),
});

export interface AiEngineConfig {
  order: AiProviderId[];
  models: Partial<
    Record<AiProviderId, { classifier?: string | null; resume?: string | null; cover?: string | null }>
  >;
  /** The tasks an engine takes (ADR 0060); an engine with no entry takes every task. */
  tasks: Partial<Record<AiProviderId, AiTask[]>>;
}

/** Parses the raw JSON column; never throws, unknown ids are dropped. */
export function parseAiEngineConfig(raw: unknown): AiEngineConfig {
  const parsed = StoredEngineSchema.safeParse(raw ?? {});
  if (!parsed.success) return { order: [], models: {}, tasks: {} };
  const order = parsed.data.order.filter(isAiProviderId);
  const models: AiEngineConfig['models'] = {};
  for (const [id, m] of Object.entries(parsed.data.models)) {
    if (isAiProviderId(id)) models[id] = m;
  }
  const tasks: AiEngineConfig['tasks'] = {};
  for (const [id, list] of Object.entries(parsed.data.tasks)) {
    if (isAiProviderId(id) && Array.isArray(list)) tasks[id] = AI_TASKS.filter((t) => list.includes(t));
  }
  return { order: [...new Set(order)], models, tasks };
}

/**
 * The priority list the user edits on /settings → AI engine: the stored
 * order, or the AI_PROVIDER engine alone while nothing is stored (ADR 0014).
 * The resolver walks it, the cards show it and their buttons change it.
 */
export function aiEngineOrder(config: AiEngineConfig, provider: AiProviderId): AiProviderId[] {
  return config.order.length > 0 ? [...config.order] : [provider];
}

/**
 * The list after pressing Enable or Disable on `id`, or null when Disable
 * would change nothing: an emptied list is seeded from AI_PROVIDER again, so
 * the .env engine cannot leave a list it is alone in.
 */
export function toggleAiEngine(
  order: readonly AiProviderId[],
  id: AiProviderId,
  provider: AiProviderId,
): AiProviderId[] | null {
  if (!order.includes(id)) return [...order, id];
  if (order.length === 1 && id === provider) return null;
  return order.filter((x) => x !== id);
}

/**
 * The list after "Use it" on a local server (TASKS S1): `id` first, the rest
 * behind it in their order as the fallback, one model in every slot.
 */
export function withEngineFirst(config: AiEngineConfig, id: AiProviderId, env: AiEngineEnv, model: string): AiEngineConfig {
  // The .env engine stands in for a list nobody stored; one that cannot run here is no fallback worth keeping.
  const behind = config.order.length > 0 ? config.order : [env.provider].filter((p) => !providerUnusable(p, env));
  // "For every task" is what the button promises: a narrower list from before is lifted.
  const tasks = { ...config.tasks };
  delete tasks[id];
  return {
    order: [id, ...behind.filter((x) => x !== id)],
    models: { ...config.models, [id]: { classifier: model, resume: model, cover: model } },
    tasks,
  };
}

/** The tasks an engine can be given at all: one that cannot search the web is never offered the web check. */
export function offeredTasks(id: AiProviderId): AiTask[] {
  return AI_TASKS.filter((t) => t !== 'verify' || PROVIDER_WEB_TOOLS[id]);
}

/**
 * The config after an engine's task boxes are saved. Every offered task
 * ticked is stored as no list at all, so a task a later version adds is
 * taken too; anything narrower is stored as picked.
 */
export function withEngineTasks(config: AiEngineConfig, id: AiProviderId, picked: readonly AiTask[]): AiEngineConfig {
  const offered = offeredTasks(id);
  const kept = offered.filter((t) => picked.includes(t));
  const tasks = { ...config.tasks };
  if (kept.length === offered.length) delete tasks[id];
  else tasks[id] = kept;
  return { ...config, tasks };
}

export interface AiEngineEnv {
  provider: AiProviderId;
  hasAnthropicKey: boolean;
  hasOpenAiKey: boolean;
  /** The OpenAI-compatible engine points at a local server, which needs no key (TASKS S1). */
  openAiLocal: boolean;
  /** CLI auth is file/env detectable — false means calls cannot work yet. */
  geminiUsable: boolean;
  codexUsable: boolean;
  classifierModel: string;
  /** CLAUDE_MODEL_RESUME / CLAUDE_MODEL_COVER from .env; '' = the backend's default for the role. */
  resumeModel: string;
  coverModel: string;
  /** OPENAI_MODEL from .env, used when the openai_api slot is empty. */
  openAiModel: string;
  /** LOCAL_MODEL: the local engine's model for an empty slot ('' = none chosen yet). */
  localModel: string;
}

/**
 * The resume role's default per Claude backend, measured 2026-09-05 on the
 * reference pair (docs/target-plan.md §2.3): the CLI caps thinking, so
 * Sonnet 5 answers a quick check there in 19 s and never broke its JSON
 * (Haiku did, twice in three calls); on the API Haiku 4.5 is the fast one
 * at 18 s while Sonnet and Opus think for a minute. Letters want the writer.
 */
const RESUME_MODEL_DEFAULT: Record<'anthropic_api' | 'claude_code', string> = {
  claude_code: 'claude-sonnet-5',
  anthropic_api: 'claude-haiku-4-5-20251001',
};
const COVER_MODEL_DEFAULT = 'claude-opus-5';

/** Engines that certainly cannot complete a call on this host right now. */
export function providerUnusable(id: AiProviderId, env: AiEngineEnv): boolean {
  switch (id) {
    case 'anthropic_api':
      return !env.hasAnthropicKey;
    case 'openai_api':
      return !env.hasOpenAiKey && !env.openAiLocal;
    case 'gemini_cli':
      return !env.geminiUsable;
    case 'agy_cli':
    case 'claude_code':
      return false; // keychain auth is not detectable — let the call decide
    case 'codex_cli':
      return !env.codexUsable;
    case 'local_api':
      return false; // no key; a server that is not running fails at once and the chain moves on
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
      if (role === 'classifier') return env.classifierModel;
      if (role === 'cover') return env.coverModel || COVER_MODEL_DEFAULT;
      return env.resumeModel || RESUME_MODEL_DEFAULT[id];
    case 'gemini_cli':
      return role === 'classifier' ? 'gemini-2.5-flash' : 'gemini-2.5-pro';
    case 'agy_cli':
      return role === 'classifier' ? 'gemini-3.8-flash-high' : 'gemini-3.1-pro-high';
    case 'openai_api':
      return env.openAiModel;
    case 'local_api':
      return env.localModel;
    case 'codex_cli':
      return '';
  }
}

export interface ResolvedAiEngine {
  /** The priority list the user edits (aiEngineOrder), usable or not. */
  order: AiProviderId[];
  /** Usable engines in priority order — never empty. */
  chain: AiProviderId[];
  /** Engines the user enabled but this host cannot run yet. */
  skipped: AiProviderId[];
  /** The engine answering because nothing in `order` can run; never in `order`. */
  lastResort: AiProviderId | null;
  modelFor(id: AiProviderId, role: AiRole): string;
  /**
   * Whether the engine takes the task: one it can be given at all (`offeredTasks`),
   * and in its list — an engine with no list takes every task it can be given.
   */
  takes(id: AiProviderId, task: AiTask): boolean;
  /**
   * The usable engines that take the task, in priority order (ADR 0060). A
   * task nobody usable takes is answered by the whole chain, as a call with
   * no task is: a narrowed list never leaves the pipeline without an engine.
   */
  chainFor(task: AiTask | null): AiProviderId[];
}

/**
 * Merges the stored chain with the .env defaults. Unusable engines are
 * skipped (reported, so the UI can explain); when nothing in the list can
 * run, the .env provider and finally claude_code answer as the last resort —
 * the pipeline always has a chain to try. Models outside the backend's
 * family fall back per role.
 */
export function resolveAiEngine(raw: unknown, env: AiEngineEnv): ResolvedAiEngine {
  const config = parseAiEngineConfig(raw);
  const order = aiEngineOrder(config, env.provider);
  const chain = order.filter((id) => !providerUnusable(id, env));
  const skipped = order.filter((id) => providerUnusable(id, env));
  let lastResort: AiProviderId | null = null;
  if (chain.length === 0) {
    lastResort = providerUnusable(env.provider, env) ? 'claude_code' : env.provider;
    chain.push(lastResort);
  }
  const takes = (id: AiProviderId, task: AiTask) => offeredTasks(id).includes(task) && (config.tasks[id]?.includes(task) ?? true);
  return {
    order,
    chain,
    skipped,
    lastResort,
    takes,
    chainFor(task) {
      const takers = task ? chain.filter((id) => takes(id, task)) : chain;
      return takers.length > 0 ? takers : chain;
    },
    modelFor(id, role) {
      // An empty slot takes the backend's default for THAT role — the cover's
      // is the strongest writer whatever the resume slot says (#184).
      const stored = config.models[id]?.[role]?.trim();
      if (stored && modelFitsProvider(stored, id)) return stored;
      return defaultModelFor(id, role, env);
    },
  };
}

/**
 * An engine card on /settings → AI engine, read off the list its button
 * edits — never off `chain`, which drops a skipped engine and holds a last
 * resort nobody enabled.
 */
export function aiEngineCard(
  engine: ResolvedAiEngine,
  id: AiProviderId,
  provider: AiProviderId,
): { enabled: boolean; position: number; lastResort: boolean; canToggle: boolean } {
  const position = engine.order.indexOf(id);
  return {
    enabled: position !== -1,
    position,
    lastResort: engine.lastResort === id,
    canToggle: toggleAiEngine(engine.order, id, provider) !== null,
  };
}

interface TaskPlan {
  task: AiTask;
  /** Who is asked, in order: the first answers, the rest are its fallback. */
  engines: AiProviderId[];
  /**
   * An engine that could take the task stands in the list and none does, so
   * every one of them may answer it. An install whose engines cannot search
   * the web has nobody to tick the web check on: it runs without, as it
   * always did, and that is not this.
   */
  unclaimed: boolean;
}

/** Who does what: each task with the engines a call for it would try (the AI tab's table). */
export function taskPlans(engine: ResolvedAiEngine): TaskPlan[] {
  return AI_TASKS.map((task) => {
    const chain = engine.chainFor(task);
    return {
      task,
      engines: task === 'verify' ? preferWebTools(chain) : chain,
      unclaimed: !engine.chain.some((id) => engine.takes(id, task)) && engine.chain.some((id) => offeredTasks(id).includes(task)),
    };
  });
}
