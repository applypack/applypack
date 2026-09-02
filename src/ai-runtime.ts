import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config';
import { logger } from './logger';
import { prisma } from './db';
import { getAiProviderById, type AiProvider } from './ai-provider';
import { SETTINGS_ID } from './settings';
import { aiKeySource, parseAiKeys, resolveAiKey, type AiKeys, type AiKeySource } from './ai-keys';
import { createCooldownTracker } from './ai-cooldown';
import {
  PROVIDER_WEB_TOOLS,
  resolveAiEngine,
  type AiEngineEnv,
  type AiProviderId,
  type AiRole,
  type ResolvedAiEngine,
} from './ai-engine';

const execFileAsync = promisify(execFile);

// Chain guards (docs/ai-engine-improvements.md item 2): at most this many
// engines per logical call, inside a deadline of FACTOR × the per-attempt
// timeout — a 3-CLI verify chain must not become a 30-minute wait.
const MAX_ENGINE_SWITCHES = 3;
const CHAIN_DEADLINE_FACTOR = 2;
const MIN_REMAINING_MS = 5_000;
// Mirrors the provider-internal CLI default timeout.
const DEFAULT_ATTEMPT_TIMEOUT_MS = 180_000;

const cooldowns = createCooldownTracker();

/**
 * The host side of the engine merge — computed per call: CLI auth can appear
 * while the process runs (login / mounted creds), and the resolver should
 * see it immediately. `keys` are the credentials pasted in the dashboard
 * (ADR 0027); they win over the matching .env variable, so the usability
 * rules in ai-engine.ts stay the single place that decides.
 */
export function getAiEngineEnv(keys: AiKeys = {}): AiEngineEnv {
  return {
    provider: config.AI_PROVIDER,
    hasAnthropicKey: Boolean(resolveAiKey('anthropic_api', keys)),
    hasOpenAiKey: Boolean(resolveAiKey('openai_api', keys)),
    geminiUsable: Boolean(keys.gemini_cli) || geminiAuthConfigured(),
    codexUsable: codexAuthConfigured(),
    classifierModel: config.CLAUDE_MODEL,
    resumeModel: config.CLAUDE_MODEL_RESUME,
    openAiModel: config.OPENAI_MODEL,
  };
}

export interface AiCallRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Short tag for log lines, e.g. 'classifier' / 'resume-match'. */
  label: string;
  /** Picks the per-engine model slot (classifier vs resume calls). */
  role: AiRole;
  timeoutMs?: number;
  webTools?: boolean;
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
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { aiEngine: true, aiKeys: true },
    });
    raw = row?.aiEngine ?? null;
    keys = parseAiKeys(row?.aiKeys ?? null);
  } catch (err) {
    logger.warn({ err }, 'ai: settings read failed, using .env engine');
  }
  const resolved = resolveAiEngine(raw, getAiEngineEnv(keys));
  return {
    chain: resolved.chain,
    skipped: resolved.skipped,
    modelFor: resolved.modelFor,
    complete: (req) => completeWithFailover(resolved, keys, req),
  };
}

async function completeWithFailover(
  engine: ResolvedAiEngine,
  keys: AiKeys,
  req: AiCallRequest,
): Promise<AiCallResult | null> {
  // Verification asks for web tools — prefer engines that have them, but a
  // tool-less engine is still better than no answer at all.
  const capable = req.webTools
    ? engine.chain.filter((id) => PROVIDER_WEB_TOOLS[id])
    : engine.chain;
  const chain = capable.length > 0 ? capable : engine.chain;
  // Engines in cooldown are skipped — unless that would leave nothing to try.
  const hot = chain.filter((id) => cooldowns.blockedUntil(id) === null);
  if (hot.length > 0 && hot.length < chain.length) {
    logger.debug(
      { cooling: chain.filter((id) => !hot.includes(id)), label: req.label },
      'ai: engines in cooldown, skipped',
    );
  }
  const tryList = (hot.length > 0 ? hot : chain).slice(0, MAX_ENGINE_SWITCHES);
  const perAttemptMs = req.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const deadline = Date.now() + perAttemptMs * CHAIN_DEADLINE_FACTOR;
  for (let i = 0; i < tryList.length; i++) {
    const id = tryList[i]!;
    const remainingMs = deadline - Date.now();
    if (i > 0 && remainingMs < MIN_REMAINING_MS) {
      logger.warn({ tried: tryList.slice(0, i), label: req.label }, 'ai: chain deadline reached');
      break;
    }
    let provider: AiProvider;
    try {
      provider = getAiProviderById(id);
    } catch (err) {
      logger.warn({ err, provider: id }, 'ai: engine not constructible, skipping');
      continue;
    }
    const model = engine.modelFor(id, req.role);
    const text = await provider.complete({
      system: req.system,
      user: req.user,
      maxTokens: req.maxTokens,
      label: req.label,
      model,
      timeoutMs: Math.min(perAttemptMs, remainingMs),
      webTools: req.webTools,
      apiKey: resolveAiKey(id, keys),
    });
    if (text !== null) {
      cooldowns.success(id);
      void recordUsage(id, req.role);
      const viaFallback = id !== engine.chain[0];
      if (viaFallback) {
        logger.warn(
          { served: id, primary: engine.chain[0], label: req.label },
          'ai: served by fallback engine',
        );
      }
      return { text, providerId: id, model, viaFallback };
    }
    cooldowns.failure(id);
    if (i < tryList.length - 1) {
      logger.warn({ failed: id, next: tryList[i + 1], label: req.label }, 'ai: engine failed, trying next');
    }
  }
  logger.error({ chain: tryList, label: req.label }, 'ai: every engine in the chain failed');
  return null;
}

/**
 * Lightweight usage counters (docs/ai-engine-improvements.md item 6):
 * runs per day × engine × role in AppSettings.aiUsage. One atomic jsonb
 * update, fire-and-forget — a counter must never fail an AI call. All the
 * COALESCE reads see the pre-update value, so nested paths self-create.
 */
async function recordUsage(id: AiProviderId, role: AiRole): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    await prisma.$executeRaw`
      UPDATE app_settings SET "aiUsage" =
        jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE("aiUsage", '{}'::jsonb),
              ARRAY[${day}], COALESCE("aiUsage"->${day}, '{}'::jsonb), true),
            ARRAY[${day}, ${id}], COALESCE("aiUsage"->${day}->${id}, '{}'::jsonb), true),
          ARRAY[${day}, ${id}, ${role}],
          to_jsonb(COALESCE(("aiUsage"->${day}->${id}->>${role})::int, 0) + 1), true)
      WHERE id = ${SETTINGS_ID}`;
  } catch (err) {
    logger.debug({ err }, 'ai: usage counter update failed');
  }
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
 * settings page calls it on every render.
 */
export async function probeAiProviders(): Promise<Record<AiProviderId, AiProviderStatus>> {
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.statuses;
  const [claude, gemini, codex, keys] = await Promise.all([
    probeCliBin(config.CLAUDE_CODE_BIN),
    probeCliBin(config.GEMINI_CLI_BIN),
    probeCliBin(config.CODEX_CLI_BIN),
    readAiKeys(),
  ]);
  const from = (id: AiProviderId): AiKeySource => aiKeySource(id, keys);
  const statuses: Record<AiProviderId, AiProviderStatus> = {
    anthropic_api:
      from('anthropic_api') === 'none'
        ? { ok: false, detail: 'paste an API key, or set ANTHROPIC_API_KEY in .env' }
        : { ok: true, detail: `API key ${keyOrigin(from('anthropic_api'))}` },
    claude_code: withClaudeAuth(claude, from('claude_code')),
    gemini_cli: withGeminiAuth(gemini, from('gemini_cli')),
    openai_api:
      from('openai_api') === 'none'
        ? {
            ok: false,
            detail: `paste an API key, or set OPENAI_API_KEY in .env (endpoint: ${baseUrlHost()})`,
          }
        : { ok: true, detail: `API key ${keyOrigin(from('openai_api'))} · ${baseUrlHost()}` },
    codex_cli: withCodexAuth(codex),
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

function baseUrlHost(): string {
  try {
    return new URL(config.OPENAI_BASE_URL).host;
  } catch {
    return config.OPENAI_BASE_URL;
  }
}

async function probeCliBin(bin: string): Promise<AiProviderStatus> {
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: PROBE_TIMEOUT_MS });
    return { ok: true, detail: stdout.trim().split('\n')[0] ?? '' };
  } catch {
    return { ok: false, detail: `${bin} not found on PATH` };
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
