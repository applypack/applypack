/*
 * Pure AI-engine resolution: which backend runs the AI calls and which model
 * ids to use. The dashboard stores an override in AppSettings (NULL = follow
 * .env); this module merges the two. No I/O — unit-tested (ai-engine.test.ts).
 */

export const AI_PROVIDER_IDS = ['anthropic_api', 'claude_code', 'gemini_cli'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic_api: 'Anthropic API',
  claude_code: 'Claude Code CLI',
  gemini_cli: 'Gemini CLI',
};

export const GEMINI_DEFAULT_CLASSIFIER_MODEL = 'gemini-2.5-flash';
export const GEMINI_DEFAULT_RESUME_MODEL = 'gemini-2.5-pro';

// Claude Code resolves these aliases in --model; the Messages API does not.
const CLAUDE_CODE_MODEL_ALIASES = new Set(['haiku', 'sonnet', 'opus']);

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** True when the model id plausibly belongs to the provider's family. */
export function modelFitsProvider(model: string, provider: AiProviderId): boolean {
  if (provider === 'gemini_cli') return model.startsWith('gemini');
  if (model.startsWith('claude')) return true;
  return provider === 'claude_code' && CLAUDE_CODE_MODEL_ALIASES.has(model);
}

/** The AppSettings columns this module reads (all NULL = follow .env). */
export interface AiEngineRow {
  aiProvider: string | null;
  aiModelClassifier: string | null;
  aiModelResume: string | null;
}

export interface AiEngineEnv {
  provider: AiProviderId;
  hasAnthropicKey: boolean;
  /** Gemini auth is file/env detectable — false means calls cannot work yet. */
  geminiUsable: boolean;
  classifierModel: string;
  resumeModel: string;
}

export interface AiEngineChoice {
  providerId: AiProviderId;
  classifierModel: string;
  resumeModel: string;
}

/**
 * Merges the stored override with the .env defaults. Unknown provider values,
 * blank models and models from the wrong family fall back; anthropic_api
 * without an API key and gemini_cli without auth fall back to the .env
 * provider (claude_code as the last resort) — a saved-but-not-yet-usable
 * preference never leaves the pipeline without a runnable engine.
 */
export function resolveAiEngine(
  row: AiEngineRow | null | undefined,
  env: AiEngineEnv,
): AiEngineChoice {
  let providerId =
    row?.aiProvider && isAiProviderId(row.aiProvider) ? row.aiProvider : env.provider;
  const unusable = (id: AiProviderId): boolean =>
    (id === 'anthropic_api' && !env.hasAnthropicKey) ||
    (id === 'gemini_cli' && !env.geminiUsable);
  if (unusable(providerId)) {
    providerId = unusable(env.provider) ? 'claude_code' : env.provider;
  }
  return {
    providerId,
    classifierModel: pickModel(
      row?.aiModelClassifier,
      providerId,
      env.classifierModel,
      GEMINI_DEFAULT_CLASSIFIER_MODEL,
    ),
    resumeModel: pickModel(
      row?.aiModelResume,
      providerId,
      env.resumeModel,
      GEMINI_DEFAULT_RESUME_MODEL,
    ),
  };
}

function pickModel(
  stored: string | null | undefined,
  provider: AiProviderId,
  claudeDefault: string,
  geminiDefault: string,
): string {
  const fallback = provider === 'gemini_cli' ? geminiDefault : claudeDefault;
  const model = stored?.trim();
  if (!model) return fallback;
  return modelFitsProvider(model, provider) ? model : fallback;
}
