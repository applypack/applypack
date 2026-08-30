import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config';
import { logger } from './logger';
import { prisma } from './db';
import { getAiProviderById, type AiProvider } from './ai-provider';
import { SETTINGS_ID } from './settings';
import {
  PROVIDER_WEB_TOOLS,
  resolveAiEngine,
  type AiEngineEnv,
  type AiProviderId,
  type AiRole,
  type ResolvedAiEngine,
} from './ai-engine';

const execFileAsync = promisify(execFile);

/**
 * The .env side of the engine merge — computed per call: CLI auth can appear
 * while the process runs (login / mounted creds), and the resolver should
 * see it immediately.
 */
export function getAiEngineEnv(): AiEngineEnv {
  return {
    provider: config.AI_PROVIDER,
    hasAnthropicKey: Boolean(config.ANTHROPIC_API_KEY),
    hasOpenAiKey: Boolean(config.OPENAI_API_KEY),
    geminiUsable: geminiAuthConfigured(),
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
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { aiEngine: true },
    });
    raw = row?.aiEngine ?? null;
  } catch (err) {
    logger.warn({ err }, 'ai: settings read failed, using .env engine');
  }
  const resolved = resolveAiEngine(raw, getAiEngineEnv());
  return {
    chain: resolved.chain,
    skipped: resolved.skipped,
    modelFor: resolved.modelFor,
    complete: (req) => completeWithFailover(resolved, req),
  };
}

async function completeWithFailover(
  engine: ResolvedAiEngine,
  req: AiCallRequest,
): Promise<AiCallResult | null> {
  // Verification asks for web tools — prefer engines that have them, but a
  // tool-less engine is still better than no answer at all.
  const capable = req.webTools
    ? engine.chain.filter((id) => PROVIDER_WEB_TOOLS[id])
    : engine.chain;
  const chain = capable.length > 0 ? capable : engine.chain;
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i]!;
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
      timeoutMs: req.timeoutMs,
      webTools: req.webTools,
    });
    if (text !== null) {
      if (i > 0) {
        logger.warn(
          { served: id, tried: chain.slice(0, i), label: req.label },
          'ai: served by fallback engine',
        );
      }
      return { text, providerId: id, model };
    }
    if (i < chain.length - 1) {
      logger.warn({ failed: id, next: chain[i + 1], label: req.label }, 'ai: engine failed, trying next');
    }
  }
  logger.error({ chain, label: req.label }, 'ai: every engine in the chain failed');
  return null;
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
  const [claude, gemini, codex] = await Promise.all([
    probeCliBin(config.CLAUDE_CODE_BIN),
    probeCliBin(config.GEMINI_CLI_BIN),
    probeCliBin(config.CODEX_CLI_BIN),
  ]);
  const statuses: Record<AiProviderId, AiProviderStatus> = {
    anthropic_api: config.ANTHROPIC_API_KEY
      ? { ok: true, detail: 'API key set' }
      : { ok: false, detail: 'set ANTHROPIC_API_KEY in .env' },
    claude_code: claude,
    gemini_cli: withGeminiAuth(gemini),
    openai_api: config.OPENAI_API_KEY
      ? { ok: true, detail: `API key set · ${baseUrlHost()}` }
      : { ok: false, detail: `set OPENAI_API_KEY in .env (endpoint: ${baseUrlHost()})` },
    codex_cli: withCodexAuth(codex),
  };
  probeCache = { at: Date.now(), statuses };
  return statuses;
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
function withGeminiAuth(bin: AiProviderStatus): AiProviderStatus {
  if (!bin.ok || geminiAuthConfigured()) return bin;
  return {
    ok: false,
    detail: `${bin.detail} installed — set GEMINI_API_KEY in .env, or log in once with \`gemini\` (mount ~/.gemini in Docker)`,
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
