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
  resolveAiEngine,
  type AiEngineChoice,
  type AiEngineEnv,
  type AiProviderId,
} from './ai-engine';

const execFileAsync = promisify(execFile);

/** The .env side of the engine merge — exported for the settings page. */
export const AI_ENGINE_ENV: AiEngineEnv = {
  provider: config.AI_PROVIDER,
  hasAnthropicKey: Boolean(config.ANTHROPIC_API_KEY),
  classifierModel: config.CLAUDE_MODEL,
  resumeModel: config.CLAUDE_MODEL_RESUME,
};

export interface AiRuntime extends AiEngineChoice {
  provider: AiProvider;
}

/**
 * Effective AI engine for one call: the AppSettings override merged with the
 * .env defaults. Read per call so a dashboard change applies on the next
 * cron tick (CLAUDE.md gotcha 9) without restarting either process.
 */
export async function getAiRuntime(): Promise<AiRuntime> {
  let row = null;
  try {
    row = await prisma.appSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { aiProvider: true, aiModelClassifier: true, aiModelResume: true },
    });
  } catch (err) {
    logger.warn({ err }, 'ai: settings read failed, using .env engine');
  }
  const choice = resolveAiEngine(row, AI_ENGINE_ENV);
  return { ...choice, provider: getAiProviderById(choice.providerId) };
}

export interface AiProviderStatus {
  ok: boolean;
  detail: string;
}

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_TTL_MS = 60_000;

let probeCache: { at: number; statuses: Record<AiProviderId, AiProviderStatus> } | null = null;

/**
 * Which backends this host can actually run: key present for the API,
 * binary on PATH for the CLIs. Cached briefly — the settings page calls it
 * on every render. Detects installation, not login state.
 */
export async function probeAiProviders(): Promise<Record<AiProviderId, AiProviderStatus>> {
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.statuses;
  const [claude, gemini] = await Promise.all([
    probeCliBin(config.CLAUDE_CODE_BIN),
    probeCliBin(config.GEMINI_CLI_BIN),
  ]);
  const statuses: Record<AiProviderId, AiProviderStatus> = {
    anthropic_api: config.ANTHROPIC_API_KEY
      ? { ok: true, detail: 'API key set' }
      : { ok: false, detail: 'set ANTHROPIC_API_KEY in .env' },
    claude_code: claude,
    gemini_cli: withGeminiAuth(gemini),
  };
  probeCache = { at: Date.now(), statuses };
  return statuses;
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
    detail: `${bin.detail} installed — run \`gemini\` once to log in, or set GEMINI_API_KEY in .env`,
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
