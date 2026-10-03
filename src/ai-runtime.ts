import { execFile } from 'node:child_process';
import { cliFailure, DEFAULT_LOCAL_CONTEXT_TOKENS } from './ai-provider-parse';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config';
import { logger } from './logger';
import { prisma } from './db';
import { getAiProviderById } from './ai-provider';
import { runChain } from './ai-failover';
import { cliCommand } from './cli-command';
import { SETTINGS_ID } from './settings';
import { aiKeySource, parseAiKeys, resolveAiKey, type AiKeys, type AiKeySource } from './ai-keys';
import { createCooldownTracker } from './ai-cooldown';
import { recordAiCall } from './ai-ledger';
import { listOllamaModels, listServerModels, LOCAL_LIST_TIMEOUT_MS } from './server-models';
import { billingOf, isLocalUrl, type AiFeature, type BillingFacts } from './ai-usage';
import {
  resolveAiEngine,
  type AiEngineEnv,
  type AiProviderId,
  type AiRole,
  type ResolvedAiEngine,
} from './ai-engine';

const execFileAsync = promisify(execFile);

const cooldowns = createCooldownTracker();

/**
 * The host side of the engine merge — computed per call: CLI auth can appear
 * while the process runs (login / mounted creds), and the resolver should
 * see it immediately. `keys` are the credentials pasted in the dashboard
 * (ADR 0027); they win over the matching .env variable, so the usability
 * rules in ai-engine.ts stay the single place that decides.
 */
export function getAiEngineEnv(keys: AiKeys = {}, openAiBaseUrl: string | null = null): AiEngineEnv {
  return {
    provider: config.AI_PROVIDER,
    hasAnthropicKey: Boolean(resolveAiKey('anthropic_api', keys)),
    hasOpenAiKey: Boolean(resolveAiKey('openai_api', keys)),
    openAiLocal: isLocalUrl(openAiBase(openAiBaseUrl)),
    geminiUsable: Boolean(keys.gemini_cli) || geminiAuthConfigured(),
    agyUsable: agyAuthConfigured(),
    codexUsable: codexAuthConfigured(),
    classifierModel: config.CLAUDE_MODEL,
    resumeModel: config.CLAUDE_MODEL_RESUME,
    coverModel: config.CLAUDE_MODEL_COVER,
    openAiModel: config.OPENAI_MODEL,
    localModel: config.LOCAL_MODEL,
  };
}

export interface AiCallRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** What the call is for — its log tag and its ledger feature, a closed set (ai-usage.ts, ADR 0055). */
  label: AiFeature;
  /** The posting and the resume the call serves, where the caller knows — so a page can say what they cost. */
  subject?: { jobId?: number; resumeId?: number };
  /** Picks the per-engine model slot (classifier vs resume calls). */
  role: AiRole;
  timeoutMs?: number;
  webTools?: boolean;
  /** The caller parses the reply as JSON; the local engine holds the model to it (ADR 0057). */
  json?: boolean;
  /** The last engine's one-line reason when no engine answers (#97) — same contract as AiRequest.onError. */
  onError?: (reason: string) => void;
}

export interface AiCallResult {
  text: string;
  providerId: AiProviderId;
  /** Model actually used; '' means the CLI's own default. */
  model: string;
  /** True when an engine other than the configured #1 served the call. */
  viaFallback: boolean;
}

export interface AiRuntime {
  /** Usable engines in priority order — the first one serves the call. */
  chain: AiProviderId[];
  /** Enabled engines this host cannot run yet (no key / not logged in). */
  skipped: AiProviderId[];
  modelFor(id: AiProviderId, role: AiRole): string;
  /** Runs the chain: first engine that answers wins; null when all fail. */
  complete(req: AiCallRequest): Promise<AiCallResult | null>;
}

/**
 * Effective AI engine chain for one call: the AppSettings config merged with
 * the .env defaults. Read per call so a dashboard change applies on the next
 * cron tick (CLAUDE.md gotcha 9) without restarting either process.
 */
export async function getAiRuntime(): Promise<AiRuntime> {
  let raw: unknown = null;
  let keys: AiKeys = {};
  let servers: EngineServers = NO_SERVERS;
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { aiEngine: true, aiKeys: true, openAiBaseUrl: true, localAiUrl: true, localContextTokens: true },
    });
    raw = row?.aiEngine ?? null;
    keys = parseAiKeys(row?.aiKeys ?? null);
    if (row) servers = { openAiBaseUrl: row.openAiBaseUrl, localAiUrl: row.localAiUrl, localContextTokens: row.localContextTokens };
  } catch (err) {
    logger.warn({ err }, 'ai: settings read failed, using .env engine');
  }
  const resolved = resolveAiEngine(raw, getAiEngineEnv(keys, servers.openAiBaseUrl));
  return {
    chain: resolved.chain,
    skipped: resolved.skipped,
    modelFor: resolved.modelFor,
    complete: (req) => completeWithFailover(resolved, keys, servers, req),
  };
}

/** Where the two base-URL engines send their calls, as the AI tab set them; null = .env's. */
export interface EngineServers {
  openAiBaseUrl: string | null;
  localAiUrl: string | null;
  localContextTokens: number | null;
}

const NO_SERVERS: EngineServers = { openAiBaseUrl: null, localAiUrl: null, localContextTokens: null };

/** The local engine's Ollama root: the one set on the AI tab, else OLLAMA_URL (ADR 0057). */
export function localAiBase(stored: string | null): string {
  return stored ?? config.OLLAMA_URL;
}

/** The OpenAI-compatible engine's server: the one set on the AI tab, else OPENAI_BASE_URL (TASKS S1). */
export function openAiBase(stored: string | null): string {
  return stored ?? config.OPENAI_BASE_URL;
}

/** The chain with this process's backends, ledger and cooldowns (ai-failover.ts). */
async function completeWithFailover(
  engine: ResolvedAiEngine,
  keys: AiKeys,
  servers: EngineServers,
  req: AiCallRequest,
): Promise<AiCallResult | null> {
  const billing = billingFacts(keys, servers.openAiBaseUrl);
  return runChain(
    engine,
    req,
    {
      keyFor: (id) => resolveAiKey(id, keys),
      openAiBase: openAiBase(servers.openAiBaseUrl),
      localBase: localAiBase(servers.localAiUrl),
      localContextTokens: servers.localContextTokens ?? DEFAULT_LOCAL_CONTEXT_TOKENS,
      billingOf: (id) => billingOf(id, billing),
    },
    { providerFor: getAiProviderById, record: recordAiCall, cooldowns, now: Date.now },
  );
}

/** What decides whose money an engine spends, from this host's settings (ai-usage.ts:billingOf). */
export function billingFacts(keys: AiKeys, openAiBaseUrl: string | null = null): BillingFacts {
  return { openAiBaseUrl: openAiBase(openAiBaseUrl), geminiKey: Boolean(resolveAiKey('gemini_cli', keys)) };
}

export interface AiProviderStatus {
  ok: boolean;
  detail: string;
}

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_TTL_MS = 60_000;

let probeCache: { at: number; statuses: Record<AiProviderId, AiProviderStatus> } | null = null;

/**
 * Which backends this host can actually run: key present for the APIs,
 * binary on PATH + detectable auth for the CLIs. Cached briefly — the
 * settings page calls it on every render. A caller that already holds the
 * stored keys passes them in rather than paying for a second read.
 */
export async function probeAiProviders(
  stored?: AiKeys,
): Promise<Record<AiProviderId, AiProviderStatus>> {
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.statuses;
  const [claude, gemini, agy, codex, keys, servers] = await Promise.all([
    probeCliBin(config.CLAUDE_CODE_BIN),
    probeCliBin(config.GEMINI_CLI_BIN),
    probeCliBin(config.AGY_CLI_BIN),
    probeCliBin(config.CODEX_CLI_BIN),
    stored ?? readAiKeys(),
    readServers(),
  ]);
  const from = (id: AiProviderId): AiKeySource => aiKeySource(id, keys);
  const openAi = openAiBase(servers.openAiBaseUrl);
  const statuses: Record<AiProviderId, AiProviderStatus> = {
    anthropic_api:
      from('anthropic_api') === 'none'
        ? { ok: false, detail: 'paste an API key, or set ANTHROPIC_API_KEY in .env' }
        : { ok: true, detail: `API key ${keyOrigin(from('anthropic_api'))}` },
    claude_code: withClaudeAuth(claude, from('claude_code')),
    gemini_cli: withGeminiAuth(gemini, from('gemini_cli')),
    agy_cli: withAgyAuth(agy),
    openai_api: isLocalUrl(openAi)
      ? await localServerStatus(openAi, resolveAiKey('openai_api', keys))
      : from('openai_api') === 'none'
        ? {
            ok: false,
            detail: `paste an API key, or set OPENAI_API_KEY in .env (endpoint: ${baseUrlHost(openAi)})`,
          }
        : { ok: true, detail: `API key ${keyOrigin(from('openai_api'))} · ${baseUrlHost(openAi)}` },
    codex_cli: withCodexAuth(codex),
    local_api: await ollamaStatus(localAiBase(servers.localAiUrl)),
  };
  probeCache = { at: Date.now(), statuses };
  return statuses;
}

/** Invalidates the probe cache so a just-saved key shows up immediately. */
export function forgetAiProbe(): void {
  probeCache = null;
}

/** Never the key itself — only where it came from. */
function keyOrigin(source: AiKeySource): string {
  return source === 'db' ? 'saved here' : 'from .env';
}

async function readAiKeys(): Promise<AiKeys> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { aiKeys: true },
    });
    return parseAiKeys(row?.aiKeys ?? null);
  } catch (err) {
    logger.warn({ err }, 'ai: key read failed, probing .env only');
    return {};
  }
}

/**
 * A server on this machine is asked what it runs (TASKS S3): a refused
 * connection answers at once, and the answer fills the model suggestions.
 * A server on the internet is not — that would be a request the user pays for.
 */
async function localServerStatus(base: string, apiKey: string | undefined): Promise<AiProviderStatus> {
  const host = baseUrlHost(base);
  const listed = await listServerModels(base, apiKey, LOCAL_LIST_TIMEOUT_MS);
  if ('reason' in listed) return { ok: false, detail: `local server · ${listed.reason}` };
  if (listed.models.length === 0) return { ok: false, detail: `local server · ${host} answers, but lists no models — pull one first` };
  const count = listed.models.length === 1 ? '1 model' : `${listed.models.length} models`;
  return { ok: true, detail: `local server · ${host} · ${count} — no key needed` };
}

/** Ollama asked what it has pulled — on this machine by construction, so it costs a local request (ADR 0057). */
async function ollamaStatus(root: string): Promise<AiProviderStatus> {
  const host = baseUrlHost(root);
  const listed = await listOllamaModels(root, LOCAL_LIST_TIMEOUT_MS);
  if ('reason' in listed) return { ok: false, detail: `Ollama · ${listed.reason}` };
  if (listed.models.length === 0) return { ok: false, detail: `Ollama · ${host} answers, but has no model yet — ollama pull one` };
  return { ok: true, detail: `Ollama · ${host} · ${listed.models.length === 1 ? '1 model' : `${listed.models.length} models`} — free, on this machine` };
}

async function readServers(): Promise<EngineServers> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { openAiBaseUrl: true, localAiUrl: true, localContextTokens: true },
    });
    return row ?? NO_SERVERS;
  } catch {
    return NO_SERVERS;
  }
}

function baseUrlHost(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

async function probeCliBin(bin: string): Promise<AiProviderStatus> {
  try {
    const command = cliCommand(bin);
    const { stdout } = await execFileAsync(command.file, [...command.prefix, '--version'], { timeout: PROBE_TIMEOUT_MS });
    return { ok: true, detail: stdout.trim().split('\n')[0] ?? '' };
  } catch (err) {
    // "not found" was the only sentence this had, whatever happened — a
    // permission bit, a hang, a non-zero exit all sent the user down the
    // wrong path (audit 2026-09-10, AI-4).
    const failure = cliFailure(err, PROBE_TIMEOUT_MS);
    return { ok: false, detail: failure.reason === 'not found on PATH' ? `${bin} not found on PATH` : `${bin}: ${failure.reason}` };
  }
}

/**
 * A fresh gemini install exits with "Please set an Auth method" in headless
 * mode, so an installed binary alone is not usable. Auth is file/env
 * detectable (unlike Claude Code's keychain), so surface it here.
 */
function withGeminiAuth(bin: AiProviderStatus, keySource: AiKeySource): AiProviderStatus {
  if (!bin.ok) return bin;
  if (keySource === 'db') return { ok: true, detail: `${bin.detail} · API key saved here` };
  if (geminiAuthConfigured()) return bin;
  return {
    ok: false,
    detail: `${bin.detail} installed — paste an API key, or log in once with \`gemini\` (mount ~/.gemini in Docker)`,
  };
}

function geminiAuthConfigured(): boolean {
  if (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI ||
    process.env.GOOGLE_GENAI_USE_GCA
  ) {
    return true;
  }
  const dir = join(homedir(), '.gemini');
  if (existsSync(join(dir, 'oauth_creds.json'))) return true;
  try {
    const s = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      selectedAuthType?: string;
      security?: { auth?: { selectedType?: string } };
    };
    return Boolean(s.selectedAuthType || s.security?.auth?.selectedType);
  } catch {
    return false;
  }
}

function withCodexAuth(bin: AiProviderStatus): AiProviderStatus {
  if (!bin.ok || codexAuthConfigured()) return bin;
  return {
    ok: false,
    detail: `${bin.detail} installed — run \`codex login\` once (mount ~/.codex in Docker)`,
  };
}

function codexAuthConfigured(): boolean {
  return existsSync(join(homedir(), '.codex', 'auth.json'));
}

function withAgyAuth(bin: AiProviderStatus): AiProviderStatus {
  if (!bin.ok || agyAuthConfigured()) return bin;
  return {
    ok: false,
    detail: `${bin.detail} installed — log in with \`agy\` once (mount ~/.gemini in Docker)`,
  };
}

function agyAuthConfigured(): boolean {
  if (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI ||
    process.env.GOOGLE_GENAI_USE_GCA
  ) {
    return true;
  }
  const dir = join(homedir(), '.gemini');
  return (
    existsSync(join(dir, 'oauth_creds.json')) ||
    existsSync(join(dir, 'google_accounts.json')) ||
    existsSync(join(dir, 'antigravity-cli'))
  );
}

/**
 * `claude --version` answers from a logged-out CLI too, so the binary alone
 * said "available" for an engine that fails on its first call. Auth is not
 * fully detectable (macOS keeps the interactive login in the Keychain), so
 * this reads the signals the CLI leaves on disk instead of spending a live
 * call on every settings render — the Test button stays the ground truth.
 */
function withClaudeAuth(bin: AiProviderStatus, keySource: AiKeySource): AiProviderStatus {
  if (!bin.ok) return bin;
  if (keySource === 'db') return { ok: true, detail: `${bin.detail} · token saved here` };
  if (claudeAuthConfigured()) return bin;
  return {
    ok: false,
    detail: `${bin.detail} installed, but not logged in — run \`claude\` once, or paste a \`claude setup-token\` token`,
  };
}

/** Where the CLI keeps its config: CLAUDE_CONFIG_DIR wins, else ~/.claude. */
function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

// ~/.claude.json also holds per-project history, so it can grow large. Above
// this size the probe stops rather than parse megabytes once a minute.
const CLAUDE_CONFIG_MAX_BYTES = 8 * 1024 * 1024;

function claudeAuthConfigured(): boolean {
  // Only the OAuth token: ANTHROPIC_API_KEY is deliberately kept out of this
  // child's environment (ai-provider-parse.ts:CLI_PROVIDER_ENV_KEYS), so
  // counting it here would call a logged-out CLI "available" again.
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  // Linux (and Docker) write the OAuth credentials next to the config.
  if (existsSync(join(claudeConfigDir(), '.credentials.json'))) return true;
  // macOS keeps the tokens in the Keychain but records the logged-in account
  // in the config file — enough to tell "logged in" from "never logged in".
  for (const file of [join(claudeConfigDir(), '.claude.json'), join(homedir(), '.claude.json')]) {
    try {
      if (statSync(file).size > CLAUDE_CONFIG_MAX_BYTES) continue;
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { oauthAccount?: unknown };
      if (parsed.oauthAccount) return true;
    } catch {
      // Missing or unreadable: try the next candidate.
    }
  }
  return false;
}
