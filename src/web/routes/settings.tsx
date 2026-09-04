/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { AtsType } from '@prisma/client';
import { z } from 'zod';
import { logger } from '../../logger';
import {
  addTelegramTarget,
  deleteTelegramTarget,
  getAiKeys,
  getSettings,
  listTelegramTargets,
  maskToken,
  setAiEngineConfig,
  setAiKey,
  setApplicationTrackingEnabled,
  setClassifierMode,
  setDisabledSources,
  setFetchingEnabled,
  setPipelineStages,
  setSourceHealthAlerts,
  setStaleApplicationsDigestEnabled,
  setTelegramEnabled,
  testTelegramTarget,
  toggleTelegramTarget,
  getSourceKeys,
  setSourceKey,
} from '../../settings';
import {
  addStage,
  allStages,
  moveStage,
  parseStageConfig,
  removeStage,
  renameStage,
  TERMINAL_KEYS,
  type StageEditError,
} from '../stage-config';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  PROVIDER_MODEL_OPTIONS,
  PROVIDER_PAID,
  defaultModelFor,
  isAiProviderId,
  modelFitsProvider,
  parseAiEngineConfig,
  resolveAiEngine,
  summarizeAiUsage,
  type AiEngineConfig,
  type AiProviderId,
} from '../../ai-engine';
import { forgetAiProbe, getAiEngineEnv, probeAiProviders } from '../../ai-runtime';
import {
  AI_KEY_ENV_VARS,
  aiKeySource,
  MAX_AI_KEY_LENGTH,
  providerTakesKey,
} from '../../ai-keys';
import {
  KEYED_SOURCES,
  MAX_SOURCE_KEY_LENGTH,
  SOURCE_KEY_FIELDS,
  envVarOf,
  isKeyedSource,
  isSourceKeyField,
  sourceKeyOrigin,
  sourceUnlocked,
  type KeyedSource,
  type SourceKeyField,
  type SourceKeys,
} from '../../source-keys';
import { testAiEngine } from '../ai-test';
import {
  blankProfileInput,
  createProfile,
  deleteProfile,
  getActiveProfile,
  getProfile,
  listProfiles,
  setActiveProfile,
  setProfileActive,
  updateProfile,
} from '../../profiles';
import { runReclassifyAll } from '../../jobs/reclassify-job';
import { recordCronRun } from '../../jobs/cron-run';
import { parseTagList, toStringArray } from '../../text-utils';
import { isCountryCode, isRegionCode, resolveCountries } from '../../countries';
import { isRelocation, parseResidence } from '../../eligibility';
import { isProfileWorkplace } from '../../location';
import { suggestSources } from '../../starter-packs/suggest';
import {
  formatPriorityRulesText,
  parsePriorityRules,
  parsePriorityRulesText,
} from '../../priority-rules';
import { prisma } from '../../db';
import { isBlankProfile } from '../../profile-guards';
import type { Profile } from '@prisma/client';
import { isSettingsTab, SettingsPage, type SourceKeyRow } from '../pages/settings';
import { sourceLabel } from '../source-names';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { missingLinkMessage } from '../profile-links';
import { createResume, getResume, listResumes } from '../../resume/store';
import { scanResume } from '../../resume/scan';
import { buildProfileDraft } from '../../resume/profile-draft';
import { nameFromFilename, readResumeUpload, resumeUploadLimit } from '../upload';

const NewTargetSchema = z.object({
  name: z.string().min(1).max(100),
  botToken: z.string().min(20).max(200),
  chatId: z.string().min(1).max(100),
});

const ProfileFormSchema = z.object({
  name: z.string().min(1).max(100),
  stackRequired: z.string().optional().default(''),
  roleTypes: z.string().optional().default(''),
  stackNiceToHave: z.string().optional().default(''),
  stackExclude: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  seniority: z.union([z.string(), z.array(z.string())]).optional(),
  // ADR 0032: chips post one value each, the no-JS textarea posts a list.
  countries: z.union([z.string(), z.array(z.string())]).optional(),
  regions: z.union([z.string(), z.array(z.string())]).optional(),
  workplace: z.union([z.string(), z.array(z.string())]).optional(),
  // ADR 0033: where the candidate lives, and whether they would move.
  residence: z.string().optional().default(''),
  relocation: z.string().optional().default('no'),
  onsiteCities: z.string().optional().default(''),
  minSalaryUsd: z.coerce.number().int().min(0).default(0),
  minFitScore: z.coerce.number().int().min(0).max(100).default(70),
  telegramTargetId: z.string().optional().default(''),
  resumeId: z.string().optional().default(''),
  priorityRules: z.string().optional().default(''),
  action: z.string().optional(),
});

// UI copy per backend; availability comes from probeAiProviders().
const AI_PROVIDER_DESCS: Record<AiProviderId, string> = {
  anthropic_api: 'Messages API with prompt caching — fastest, pays per token.',
  claude_code: 'Headless claude -p on your Claude.ai subscription. Slower, no per-token bill.',
  gemini_cli: 'Headless gemini -p on your Google account or GEMINI_API_KEY.',
  openai_api:
    'Any server speaking /chat/completions: OpenAI, OpenRouter, Groq, local LM Studio / Ollama. Pays per token (or free locally).',
  codex_cli: 'Headless codex exec on your ChatGPT subscription.',
};

let reclassifyInFlight = false;

export const settingsRoute = new Hono();

/** Everything the settings page needs except activeTab/flash/profileDraft —
 *  shared by the GET and by POSTs that render a draft instead of redirecting. */
async function loadSettingsProps() {
  // The keys are read once and lent to the probe — both need them (ADR 0027).
  const aiKeys = await getAiKeys();
  const [settings, targets, profiles, active, resumes, aiStatuses, stageCounts] =
    await Promise.all([
      getSettings(),
      listTelegramTargets(),
      listProfiles(),
      getActiveProfile(),
      listResumes(),
      probeAiProviders(aiKeys),
      prisma.job.groupBy({
        by: ['pipelineStage'],
        _count: { _all: true },
        where: { pipelineStage: { not: null } },
      }),
    ]);
  const countByStage = new Map(
    stageCounts.map((row) => [row.pipelineStage, row._count._all]),
  );
  const aiEnv = getAiEngineEnv(aiKeys);
  const engine = resolveAiEngine(settings.aiEngine, aiEnv);
  const aiConfig = parseAiEngineConfig(settings.aiEngine);
  // With no stored config the .env-seeded chain is shown as enabled.
  const enabledOrder = aiConfig.order.length > 0 ? aiConfig.order : engine.chain;
  const aiEngines = AI_PROVIDER_IDS.map((id) => {
    const position = enabledOrder.indexOf(id);
    const classifierDefault = defaultModelFor(id, 'classifier', aiEnv) || 'CLI default';
    const resumeDefault = defaultModelFor(id, 'resume', aiEnv) || 'CLI default';
    const storedKey = providerTakesKey(id) ? aiKeys[id] : undefined;
    return {
      id,
      label: AI_PROVIDER_LABELS[id],
      desc: AI_PROVIDER_DESCS[id],
      ok: aiStatuses[id].ok,
      detail: aiStatuses[id].detail,
      enabled: position !== -1,
      position,
      classifierModel: aiConfig.models[id]?.classifier ?? '',
      resumeModel: aiConfig.models[id]?.resume ?? '',
      coverModel: aiConfig.models[id]?.cover ?? '',
      classifierDefault,
      resumeDefault,
      // An empty cover slot follows the resume model, so that is the default shown.
      coverDefault: aiConfig.models[id]?.resume?.trim() || resumeDefault,
      options: PROVIDER_MODEL_OPTIONS[id],
      freeTextModels: id === 'openai_api',
      paid: PROVIDER_PAID[id],
      // ADR 0027: the field takes a key, it never hands one back — only the
      // last four characters of what is stored, and where it came from.
      keyEnvVar: providerTakesKey(id) ? AI_KEY_ENV_VARS[id] : null,
      keySource: aiKeySource(id, aiKeys),
      maskedKey: storedKey ? maskToken(storedKey) : '',
    };
  }).sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.enabled ? a.position - b.position : 0;
  });
  const primary = engine.chain[0]!;
  const aiStatus = {
    active: AI_PROVIDER_LABELS[primary],
    chain: engine.chain.map((id) => AI_PROVIDER_LABELS[id]),
    skipped: engine.skipped.map((id) => AI_PROVIDER_LABELS[id]),
    usage7d: summarizeAiUsage(settings.aiUsage, 7, new Date()).map((r) => ({
      label: AI_PROVIDER_LABELS[r.id],
      classifier: r.classifier,
      resume: r.resume,
      cover: r.cover,
    })),
  };
  return {
    telegramEnabled: settings.telegramEnabled,
    classifierMode: settings.classifierMode,
    applicationTrackingEnabled: settings.applicationTrackingEnabled,
    pipelineStages: allStages(parseStageConfig(settings.pipelineStages)).map((s) => ({
      ...s,
      count: countByStage.get(s.key) ?? 0,
      fixed: s.key === 'applied' || TERMINAL_KEYS.includes(s.key),
    })),
    staleApplicationsDigestEnabled: settings.staleApplicationsDigestEnabled,
    sourceHealthAlerts: settings.sourceHealthAlerts,
    disabledSources: settings.disabledSources,
    allSources: Object.values(AtsType).filter((t) => t !== AtsType.MANUAL),
    sourceKeyRows: sourceKeyRows(await getSourceKeys()),
    fetchingEnabled: settings.fetchingEnabled,
    aiEngines,
    aiStatus,
    targets: targets.map((t) => ({
      id: t.id,
      name: t.name,
      maskedToken: maskToken(t.botToken),
      chatId: t.chatId,
      active: t.active,
      createdAt: t.createdAt,
      lastUsed: t.lastUsed,
    })),
    profiles: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      running: p.active,
      primary: active?.id === p.id,
      blank: isBlankProfile(p),
    })),
    activeProfile: active,
    availableTargets: targets.map((t) => ({
      id: t.id,
      name: t.name,
      active: t.active,
    })),
    resumes: resumes.map((r) => ({
      id: r.id,
      name: r.name,
      isDefault: r.isDefault,
      scannedAt: r.scannedAt,
    })),
  };
}

settingsRoute.get('/settings', async (c) => {
  const props = await loadSettingsProps();
  const tabParam = c.req.query('tab');
  const activeTab = isSettingsTab(tabParam) ? tabParam : 'general';
  // ?profile= points the editor at a specific (possibly inactive) profile.
  // "+ New profile" lands here: new profiles are born inactive (issue #50)
  // and must be editable before activation.
  const profileParam = Number(c.req.query('profile'));
  if (Number.isFinite(profileParam)) {
    const editorProfile = await getProfile(profileParam);
    if (editorProfile) props.activeProfile = editorProfile;
  }
  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(<SettingsPage {...props} activeTab={activeTab} flash={flash} />, 200, {
    'Set-Cookie': clearFlashCookie(),
  });
});

// --- Fetching pause / resume -----------------------------------------------

settingsRoute.post('/settings/fetching-toggle', async (c) => {
  // The Overview quick control posts back="/" to land where it came from.
  const form = await c.req.parseBody();
  const back = form.back === '/' ? '/' : '/settings?tab=general';
  const settings = await getSettings();
  const enabling = !settings.fetchingEnabled;
  await setFetchingEnabled(enabling);
  if (!enabling) {
    return flashRedirect(back, 'warn', 'Job fetching paused — no new jobs or alerts until you resume.');
  }
  const profile = await getActiveProfile();
  const gateEmpty =
    !profile || (profile.stackRequired.length === 0 && profile.roleTypes.length === 0);
  if (gateEmpty) {
    return flashRedirect(
      back,
      'warn',
      'Job fetching resumed, but no running search has a required stack or role types — every fetched job goes to the AI classifier. Fill one in first (Settings → Profile).',
    );
  }
  return flashRedirect(back, 'ok', 'Job fetching resumed — next hourly tick will pull new jobs.');
});

// --- Telegram toggle / targets ---------------------------------------------

settingsRoute.post('/settings/telegram-toggle', async (c) => {
  const settings = await getSettings();
  await setTelegramEnabled(!settings.telegramEnabled);
  return flashRedirect(
    '/settings?tab=notifications',
    'ok',
    `Telegram alerts ${!settings.telegramEnabled ? 'enabled' : 'disabled'}.`,
  );
});

/** Reads the stored chain, seeding it from .env when nothing is saved yet. */
async function readAiOrder(): Promise<{ order: AiProviderId[]; config: AiEngineConfig }> {
  const settings = await getSettings();
  const config = parseAiEngineConfig(settings.aiEngine);
  const order = config.order.length > 0 ? [...config.order] : [getAiEngineEnv().provider];
  return { order, config };
}

settingsRoute.post('/settings/ai/enable', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', 'Unknown engine.');
  const { order, config } = await readAiOrder();
  const label = AI_PROVIDER_LABELS[provider];
  if (order.includes(provider)) {
    const next = order.filter((id) => id !== provider);
    await setAiEngineConfig({ ...config, order: next });
    if (next.length === 0) {
      return flashRedirect(
        '/settings?tab=ai',
        'warn',
        `${label} disabled. No engines left — the pipeline falls back to the .env default.`,
      );
    }
    return flashRedirect('/settings?tab=ai', 'ok', `${label} disabled.`);
  }
  const next = [...order, provider];
  await setAiEngineConfig({ ...config, order: next });
  const statuses = await probeAiProviders();
  if (!statuses[provider].ok) {
    return flashRedirect(
      '/settings?tab=ai',
      'warn',
      `${label} enabled as priority #${next.length}, but it is not usable here yet (${statuses[provider].detail}). It is skipped until that is fixed.`,
    );
  }
  // A metered engine standing behind subscription engines = money spent
  // exactly when the free capacity runs out — say so up front.
  if (PROVIDER_PAID[provider] && next.slice(0, -1).some((id) => !PROVIDER_PAID[id])) {
    return flashRedirect(
      '/settings?tab=ai',
      'warn',
      `${label} enabled as priority #${next.length}. It pays per token — it will spend money whenever the engines above it fail or run out of quota.`,
    );
  }
  return flashRedirect('/settings?tab=ai', 'ok', `${label} enabled as priority #${next.length}.`);
});

settingsRoute.post('/settings/ai/move', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', 'Unknown engine.');
  const { order, config } = await readAiOrder();
  const idx = order.indexOf(provider);
  if (idx <= 0) return flashRedirect('/settings?tab=ai', 'ok', 'Already at the top.');
  const next = [...order];
  [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
  await setAiEngineConfig({ ...config, order: next });
  return flashRedirect(
    '/settings?tab=ai',
    'ok',
    `${AI_PROVIDER_LABELS[provider]} moved to priority #${idx}.`,
  );
});

settingsRoute.post('/settings/ai/models', async (c) => {
  const form = await c.req.parseBody();
  // The cards save on change over fetch and want JSON back; the no-JS form
  // post wants the usual redirect + flash.
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
  const fail = (message: string) =>
    wantsJson ? c.json({ error: message }, 400) : flashRedirect('/settings?tab=ai', 'err', message);
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return fail('Unknown engine.');
  const label = AI_PROVIDER_LABELS[provider];
  const classifier = cleanModelId(form.classifier);
  const resume = cleanModelId(form.resume);
  const cover = cleanModelId(form.cover);
  for (const model of [classifier, resume, cover]) {
    if (model && !modelFitsProvider(model, provider)) {
      return fail(`"${model}" is not a ${label} model id. Nothing saved.`);
    }
  }
  const { config } = await readAiOrder();
  await setAiEngineConfig({
    ...config,
    models: { ...config.models, [provider]: { classifier, resume, cover } },
  });
  return wantsJson
    ? c.json({ ok: true })
    : flashRedirect('/settings?tab=ai', 'ok', `${label} models saved.`);
});

/**
 * Saves or removes one engine's pasted credential (ADR 0027). The value never
 * comes back to the browser and never reaches a log line or a flash message —
 * the response says which engine changed, not what was stored.
 */
settingsRoute.post('/settings/ai/key', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider) || !providerTakesKey(provider)) {
    return flashRedirect('/settings?tab=ai', 'err', 'That engine does not take a pasted key.');
  }
  const label = AI_PROVIDER_LABELS[provider];
  const clearing = form.clear === '1';
  const key = typeof form.key === 'string' ? form.key.trim() : '';
  if (!clearing && key.length === 0) {
    return flashRedirect('/settings?tab=ai', 'err', `Paste a ${label} key first.`);
  }
  if (key.length > MAX_AI_KEY_LENGTH) {
    return flashRedirect(
      '/settings?tab=ai',
      'err',
      `That is ${key.length} characters — longer than any API key. Nothing saved.`,
    );
  }
  await setAiKey(provider, clearing ? '' : key);
  forgetAiProbe();
  if (clearing) {
    const fallback = aiKeySource(provider, {}) === 'env' ? ` Falling back to ${AI_KEY_ENV_VARS[provider]} from .env.` : '';
    return flashRedirect('/settings?tab=ai', 'ok', `${label} key removed.${fallback}`);
  }
  return flashRedirect('/settings?tab=ai', 'ok', `${label} key saved. Press Test to prove it works.`);
});

/** The keyed sources as the Sources tab shows them — origins and masks, never values (ADR 0034). */
function sourceKeyRows(keys: SourceKeys): SourceKeyRow[] {
  return KEYED_SOURCES.map((source) => {
    const meta = SOURCE_KEY_META[source];
    return {
      source,
      label: meta.label,
      what: meta.what,
      worthIt: meta.worthIt,
      cost: meta.cost,
      signupUrl: meta.signupUrl,
      signupLabel: meta.signupLabel,
      terms: meta.terms,
      termsUrl: meta.termsUrl,
      ready: sourceUnlocked(source, keys),
      fields: (Object.keys(SOURCE_KEY_FIELDS[source]) as SourceKeyField[]).map((field) => {
        const origin = sourceKeyOrigin(source, field, keys);
        const stored = keys[source]?.[field];
        return {
          field,
          label: meta.fields[field] ?? field,
          envVar: envVarOf(source, field),
          origin,
          masked: origin === 'db' && stored ? maskToken(stored) : '',
        };
      }),
    };
  });
}

/** UI copy per keyed source: the vendor's own name for each field, and the terms the user accepted. */
const SOURCE_KEY_META: Record<
  KeyedSource,
  { label: string; what: string; worthIt: string; cost: string; signupUrl: string; signupLabel: string; terms: string; termsUrl: string; fields: Record<string, string> }
> = {
  ADZUNA: {
    label: 'Adzuna',
    what: 'A job-ad aggregator covering nineteen countries — Germany, France, Spain, Italy, the Netherlands, Poland, the UK, the US, Canada, Australia, India and more — including ads from boards this app has no other way to see.',
    worthIt:
      'you hunt in a country the free sources barely cover (ES, IT, BE, CH, AT, IN, BR, MX, ZA, AU, NZ, SG, CA) or want a wider net than the tech-specific boards. Skip it if you hunt remote-first English roles or in UA, PL, DE, GB, NL, PT, SE — the free sources already cover those.',
    cost: 'personal research only (a company needs its own licence from Adzuna), a "Jobs by Adzuna" label on every listing shown, and 2 500 calls a month — so a market is checked four times a day and ten markets is the ceiling. Descriptions arrive as snippets, so the classifier and the resume match see less than usual.',
    signupUrl: 'https://developer.adzuna.com/signup',
    signupLabel: 'Register for a free key (developer.adzuna.com)',
    terms: 'API terms',
    termsUrl: 'https://developer.adzuna.com/docs/terms_of_service',
    fields: { app_id: 'Application ID', app_key: 'Application key' },
  },
  FRANCETRAVAIL: {
    label: 'France Travail',
    what: "The French state employment service's own API: every public job ad in France, with full descriptions — the most complete source there is for that country.",
    worthIt: 'you hunt in France. It adds nothing anywhere else, so leave it alone otherwise.',
    cost: 'the board\'s licence: every offer is shown whole with its source, date and licence link, and each stored offer is re-checked daily — so leave fetching on, or switch its rows off. Offers the board withdraws are deleted here, or kept anonymised when they are your own application record. Charging job seekers for a service built on this data is forbidden by French law.',
    signupUrl: 'https://francetravail.io/produits-partages/catalogue',
    signupLabel: 'Create a free account and an app (francetravail.io)',
    terms: 'Licence offres d\'emploi',
    termsUrl: 'https://francetravail.io/produits-partages/documentation/conditions-dutilisation-api/licence-offres-emploi',
    fields: { client_id: 'Client ID', client_secret: 'Client secret' },
  },
};

/**
 * Saves or removes one field of a keyed source's credential (ADR 0034). As
 * with engine keys, the value never comes back to the browser, a log line
 * or a flash message.
 */
settingsRoute.post('/settings/sources/key', async (c) => {
  const form = await c.req.parseBody();
  const source = typeof form.source === 'string' ? form.source : '';
  const field = typeof form.field === 'string' ? form.field : '';
  if (!isKeyedSource(source) || !isSourceKeyField(source, field)) {
    return flashRedirect('/settings?tab=sources', 'err', 'That source takes no such key.');
  }
  const label = `${SOURCE_KEY_META[source].label} ${SOURCE_KEY_META[source].fields[field] ?? field}`;
  const clearing = form.clear === '1';
  const key = typeof form.key === 'string' ? form.key.trim() : '';
  if (!clearing && key.length === 0) {
    return flashRedirect('/settings?tab=sources', 'err', `Paste the ${label} first.`);
  }
  if (key.length > MAX_SOURCE_KEY_LENGTH) {
    return flashRedirect('/settings?tab=sources', 'err', `That is ${key.length} characters — longer than any key. Nothing saved.`);
  }
  await setSourceKey(source, field, clearing ? '' : key);
  return flashRedirect('/settings?tab=sources', 'ok', clearing ? `${label} removed.` : `${label} saved.`);
});

settingsRoute.post('/settings/ai/test', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', 'Unknown engine.');
  const result = await testAiEngine(provider);
  return flashRedirect('/settings?tab=ai', result.ok ? 'ok' : 'err', result.text);
});

function cleanModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 100) : null;
}

settingsRoute.post('/settings/classifier-mode', async (c) => {
  const form = await c.req.parseBody();
  const raw = form.mode;
  const mode = raw === 'two_stage' ? 'two_stage' : 'single';
  await setClassifierMode(mode);
  const label = mode === 'two_stage' ? 'Two stage' : 'Single stage';
  return flashRedirect('/settings?tab=ai', 'ok', `Classifier mode → ${label}.`);
});

settingsRoute.post('/settings/application-tracking-toggle', async (c) => {
  const settings = await getSettings();
  await setApplicationTrackingEnabled(!settings.applicationTrackingEnabled);
  return flashRedirect(
    '/settings?tab=general',
    'ok',
    `Application tracking ${
      !settings.applicationTrackingEnabled ? 'enabled' : 'disabled'
    }.`,
  );
});

// ---- Board columns (ADR 0025) ------------------------------------------

const STAGES_BACK = '/settings?tab=general#stages';

const STAGE_ERROR_TEXT: Record<StageEditError, string> = {
  'empty-label': 'Column name is required.',
  'duplicate-label': 'A column with that name already exists.',
  limit: 'Column limit reached — remove one first.',
  'unknown-key': 'That column no longer exists.',
  'last-column': 'Keep at least one column between Applied and Closed.',
};

async function applyStageEdit(
  edit: (work: { key: string; label: string }[]) =>
    | { key: string; label: string }[]
    | StageEditError,
  okText: string,
): Promise<Response> {
  const settings = await getSettings();
  const work = parseStageConfig(settings.pipelineStages);
  const next = edit(work);
  if (typeof next === 'string') {
    return flashRedirect(STAGES_BACK, 'err', STAGE_ERROR_TEXT[next]);
  }
  await setPipelineStages(next);
  return flashRedirect(STAGES_BACK, 'ok', okText);
}

settingsRoute.post('/settings/stages/add', async (c) => {
  const form = await c.req.parseBody();
  const label = typeof form.label === 'string' ? form.label : '';
  return applyStageEdit(
    (work) => addStage(work, label),
    `Added "${label.trim()}".`,
  );
});

settingsRoute.post('/settings/stages/:key/remove', async (c) => {
  const key = c.req.param('key');
  const inUse = await prisma.job.count({ where: { pipelineStage: key } });
  if (inUse > 0) {
    return flashRedirect(
      STAGES_BACK,
      'err',
      `Move ${inUse} job${inUse === 1 ? '' : 's'} out of that column first.`,
    );
  }
  return applyStageEdit((work) => removeStage(work, key), 'Column removed.');
});

settingsRoute.post('/settings/stages/:key/move', async (c) => {
  const key = c.req.param('key');
  const form = await c.req.parseBody();
  const dir = form.dir === 'up' ? 'up' : 'down';
  return applyStageEdit((work) => moveStage(work, key, dir), 'Order updated.');
});

settingsRoute.post('/settings/stages/:key/rename', async (c) => {
  const key = c.req.param('key');
  const form = await c.req.parseBody();
  const label = typeof form.label === 'string' ? form.label : '';
  return applyStageEdit(
    (work) => renameStage(work, key, label),
    'Column renamed.',
  );
});

settingsRoute.post('/settings/stale-digest-toggle', async (c) => {
  const settings = await getSettings();
  await setStaleApplicationsDigestEnabled(
    !settings.staleApplicationsDigestEnabled,
  );
  return flashRedirect(
    '/settings?tab=general',
    'ok',
    `Stale-applications digest ${
      !settings.staleApplicationsDigestEnabled ? 'enabled' : 'disabled'
    }.`,
  );
});

settingsRoute.post('/settings/source-health-toggle', async (c) => {
  const settings = await getSettings();
  await setSourceHealthAlerts(!settings.sourceHealthAlerts);
  return flashRedirect(
    '/settings?tab=notifications',
    'ok',
    `Source health alerts ${!settings.sourceHealthAlerts ? 'enabled' : 'disabled'}.`,
  );
});

settingsRoute.post('/settings/sources', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const enabled = (
    Array.isArray(form.enabled)
      ? form.enabled
      : form.enabled
        ? [form.enabled]
        : []
  ).filter((v): v is string => typeof v === 'string');
  // MANUAL is not a fetchable source — keep it out of disabledSources.
  const allSources = Object.values(AtsType).filter((s) => s !== AtsType.MANUAL) as string[];
  // disabledSources = everything NOT in the submitted "enabled" set.
  const disabled = allSources.filter((s) => !enabled.includes(s));
  await setDisabledSources(disabled);
  return flashRedirect(
    '/settings?tab=sources',
    'ok',
    disabled.length === 0
      ? 'All sources enabled.'
      : `Disabled: ${disabled.map(sourceLabel).join(', ')}.`,
  );
});

settingsRoute.post('/settings/targets', async (c) => {
  const form = await c.req.parseBody();
  const parsed = NewTargetSchema.safeParse({
    name: form.name,
    botToken: form.botToken,
    chatId: form.chatId,
  });
  if (!parsed.success) {
    return flashRedirect('/settings?tab=notifications', 'err', 'Invalid input — name, token, chat id required.');
  }
  const test = await testTelegramTarget(parsed.data.botToken, parsed.data.chatId);
  if (!test.ok) {
    return flashRedirect(
      '/settings?tab=notifications',
      'err',
      `Validation failed: ${test.error ?? 'unknown'}`,
    );
  }
  await addTelegramTarget(parsed.data);
  return flashRedirect(
    '/settings?tab=notifications',
    'ok',
    `Added target "${parsed.data.name}" (bot @${test.botUsername ?? '?'}). Test message sent.`,
  );
});

settingsRoute.post('/settings/targets/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await toggleTelegramTarget(id);
  return flashRedirect('/settings?tab=notifications', 'ok', 'Target toggled.');
});

settingsRoute.post('/settings/targets/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await deleteTelegramTarget(id);
  return flashRedirect('/settings?tab=notifications', 'ok', 'Target deleted.');
});

settingsRoute.post('/settings/targets/:id/test', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const t = await prisma.telegramTarget.findUnique({ where: { id } });
  if (!t) return flashRedirect('/settings?tab=notifications', 'err', 'Target not found.');
  const result = await testTelegramTarget(t.botToken, t.chatId);
  if (result.ok) {
    return flashRedirect(
      '/settings?tab=notifications',
      'ok',
      `Test sent to "${t.name}" (bot @${result.botUsername ?? '?'}).`,
    );
  }
  return flashRedirect('/settings?tab=notifications', 'err', `Test failed: ${result.error ?? 'unknown'}`);
});

// --- Profiles ---------------------------------------------------------------

settingsRoute.post('/settings/profiles/new', async (c) => {
  const profile = await createProfile(blankProfileInput());
  // Born inactive (issue #50): a blank profile must never become the
  // scoring profile. The first save with real content activates it.
  return flashRedirect(
    `/settings?tab=profile&profile=${profile.id}`,
    'ok',
    'New search created. Add a required stack or role types and save — it starts running on the first save with content.',
  );
});

// ADR 0028: run or pause one search. The primary is refused server-side —
// the hidden Run/Pause button is advisory only.
settingsRoute.post('/settings/profiles/active', async (c) => {
  const form = await c.req.parseBody();
  const id = Number(form.id);
  const want = form.active === '1';
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', 'Invalid id.');
  // Server-side half of the gate (issue #50): a search with nothing to match
  // on would admit every posting and score it on vibes.
  const target = await getProfile(id);
  if (want && target && isBlankProfile(target)) {
    return flashRedirect(
      `/settings?tab=profile&profile=${id}`,
      'err',
      'This search has no required stack and no role types — fill it in and save before running it.',
    );
  }
  try {
    await setProfileActive(id, want);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      err instanceof Error ? err.message : 'Failed to change the search.',
    );
  }
  return flashRedirect(
    '/settings?tab=profile',
    'ok',
    want
      ? `"${target?.name ?? 'Search'}" is running — new postings are scored against it too. "Save & re-classify" in its editor scores the ones already stored.`
      : `"${target?.name ?? 'Search'}" paused. Its existing scores stay on the jobs it already scored.`,
  );
});

settingsRoute.post('/settings/profiles/activate', async (c) => {
  const form = await c.req.parseBody();
  const id = Number(form.id);
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', 'Invalid id.');
  // Server-side half of the activation gate (issue #50) — the disabled
  // Activate button is advisory only.
  const target = await getProfile(id);
  if (target && isBlankProfile(target)) {
    return flashRedirect(
      `/settings?tab=profile&profile=${id}`,
      'err',
      'This search has no required stack and no role types — fill it in and save before making it primary.',
    );
  }
  try {
    await setActiveProfile(id);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      err instanceof Error ? err.message : 'Failed to change the primary search.',
    );
  }
  return flashRedirect(
    '/settings?tab=profile',
    'ok',
    'Primary search changed. It also runs from now on; "Save & re-classify" in the editor re-scores existing jobs.',
  );
});

settingsRoute.post('/settings/profiles/delete', async (c) => {
  const form = await c.req.parseBody();
  const id = Number(form.id);
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', 'Invalid id.');
  try {
    await deleteProfile(id);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      err instanceof Error ? err.message : 'Delete failed.',
    );
  }
  return flashRedirect('/settings?tab=profile', 'ok', 'Search deleted.');
});

settingsRoute.post('/settings/profiles/:id/save', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const before = await getProfile(id);
  if (!before) {
    return flashRedirect('/settings?tab=profile', 'err', 'Profile not found.');
  }

  // `all: true` is required so multi-value checkboxes (seniority,
  // remoteRegions) come back as arrays instead of just the last value.
  const form = await c.req.parseBody({ all: true });
  const parsed = ProfileFormSchema.safeParse(form);
  if (!parsed.success) {
    logger.warn(
      { errors: parsed.error.flatten().fieldErrors, form },
      'profile form: validation failed',
    );
    return flashRedirect('/settings?tab=profile', 'err', 'Invalid form values.');
  }
  const f = parsed.data;

  const telegramTargetId = optionalId(f.telegramTargetId);
  const resumeId = optionalId(f.resumeId);

  const { rules: priorityRules, errors: priorityErrors } =
    parsePriorityRulesText(f.priorityRules);
  if (priorityErrors.length > 0) {
    const first = priorityErrors[0]!;
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      `Priority rules — line ${first.line}: ${first.reason}. Profile not saved.`,
    );
  }

  // Both ids come from dropdowns rendered when the page loaded; either row
  // can be gone by the time the form arrives (issue #73). Prisma's answer to
  // a dead id is a raw foreign-key error — a 500 with the whole edit lost.
  const [resumeRow, targetRow] = await Promise.all([
    resumeId === null ? null : getResume(resumeId),
    telegramTargetId === null
      ? null
      : prisma.telegramTarget.findUnique({ where: { id: telegramTargetId }, select: { id: true } }),
  ]);
  const missing = missingLinkMessage({
    resumeGone: resumeId !== null && resumeRow === null,
    telegramTargetGone: telegramTargetId !== null && targetRow === null,
  });
  if (missing) return flashRedirect('/settings?tab=profile', 'err', missing);

  // Countries arrive as names, codes or flags in any spelling; an entry the
  // gazetteer does not know is an error, not a silent drop.
  const countries = resolveCountries(toStringArray(f.countries).flatMap(parseTagList));
  if (countries.unknown.length > 0) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      `Country not recognised: ${countries.unknown.join(', ')}. Profile not saved.`,
    );
  }

  const input = {
    name: f.name,
    stackRequired: parseTagList(f.stackRequired),
    roleTypes: parseTagList(f.roleTypes),
    stackNiceToHave: parseTagList(f.stackNiceToHave),
    stackExclude: parseTagList(f.stackExclude),
    notes: f.notes && f.notes.trim().length > 0 ? f.notes.trim() : null,
    seniority: toStringArray(f.seniority),
    countries: countries.codes,
    regions: toStringArray(f.regions).filter(isRegionCode),
    workplace: toStringArray(f.workplace).filter(isProfileWorkplace),
    residence: parseResidence(f.residence, isCountryCode),
    relocation: isRelocation(f.relocation) ? f.relocation : 'no',
    onsiteCities: parseTagList(f.onsiteCities),
    minSalaryUsd: f.minSalaryUsd,
    minFitScore: f.minFitScore,
    telegramTargetId,
    resumeId,
    priorityRules,
  };
  const saved = await updateProfile(id, input);

  // The second half of "born inactive" (issue #50): the first save that gives
  // a blank search real content starts it running. Since ADR 0028 that no
  // longer displaces anything — the searches already running keep running, and
  // the primary is untouched.
  let isActive = before.active;
  let activated = false;
  if (!isActive && isBlankProfile(before) && !isBlankProfile(input)) {
    await setProfileActive(id, true);
    isActive = true;
    activated = true;
  }
  const active = await getActiveProfile();
  const editorUrl =
    active?.id === id ? '/settings?tab=profile' : `/settings?tab=profile&profile=${id}`;
  // Plan §4.3: a running search that names Ukraine, Germany or the UK has
  // feeds waiting on /companies — say so on the save, where the countries were picked.
  const sourcesHint = isActive ? await sourcesWaiting(saved) : '';

  if (f.action === 'save-and-reclassify') {
    if (!isActive) {
      return flashRedirect(
        editorUrl,
        'warn',
        'Search saved, but re-classify skipped — it scores against running searches only. Press Run first.',
      );
    }
    triggerReclassifyAsync();
    return flashRedirect(
      editorUrl,
      'ok',
      `Search saved${activated ? ' and started' : ''}. Re-classify started in the background — track progress at /runs.${sourcesHint}`,
    );
  }
  if (activated) {
    return flashRedirect(editorUrl, 'ok', `Search saved and started — it scores new postings from the next tick.${sourcesHint}`);
  }
  if (!isActive && isBlankProfile(input)) {
    return flashRedirect(
      editorUrl,
      'ok',
      'Search saved. It stays paused until it lists a required stack or role types.',
    );
  }
  return flashRedirect(editorUrl, 'ok', `Search saved.${sourcesHint}`);
});

/** " 2 sources fit these countries — see Companies → …", or '' when every suggested feed already runs. */
async function sourcesWaiting(search: Profile): Promise<string> {
  const tracked = await prisma.company.findMany({ select: { id: true, atsType: true, atsToken: true, active: true } });
  const waiting = suggestSources([search], tracked).filter((s) => s.state !== 'on').length;
  if (waiting === 0) return '';
  return ` ${waiting} source${waiting === 1 ? '' : 's'} fit these countries — see Companies → "Sources for your searches".`;
}

// Prefill the editor from a resume's AI scan. Renders the draft directly —
// nothing is saved until the user submits the profile form. With no resumes
// yet the card sends a file instead of a resumeId: the upload becomes a real
// Resume row (first one turns default in createResume), then the same flow.
settingsRoute.post(
  '/settings/profiles/:id/fill-from-resume',
  resumeUploadLimit('/settings?tab=profile'),
  async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const profile = await getProfile(id);
  if (!profile) return flashRedirect('/settings?tab=profile', 'err', 'Profile not found.');
  const form = await c.req.parseBody();
  let resume;
  if (form.file instanceof File && form.file.size > 0) {
    const upload = await readResumeUpload(form);
    if ('error' in upload) return flashRedirect('/settings?tab=profile', 'err', upload.error);
    resume = await createResume({ name: nameFromFilename(upload.sourceFilename), ...upload });
  } else {
    const resumeId = Number(form.resumeId);
    if (!Number.isFinite(resumeId)) {
      return flashRedirect('/settings?tab=profile', 'err', 'Pick a resume first.');
    }
    resume = await getResume(resumeId);
  }
  if (!resume || resume.hidden) {
    return flashRedirect('/settings?tab=profile', 'err', 'Resume not found.');
  }

  // Scans from before the primary-stack field (or failed ones) re-scan here.
  if (!resume.scannedAt || resume.primarySkills.length === 0) {
    const scan = await scanResume({ id: resume.id, text: resume.text });
    if (!scan) {
      return flashRedirect(
        '/settings?tab=profile',
        'err',
        `The AI scan of "${resume.name}" failed — check the web logs and try again.`,
      );
    }
    resume = (await getResume(resume.id)) ?? resume;
  }

  const draft = buildProfileDraft(profile, {
    title: resume.title,
    seniority: resume.seniority,
    skills: resume.skills,
    primarySkills: resume.primarySkills,
    roleTypes: resume.roleTypes,
  });
  // Filling from a resume also proposes it as the search's resume — same
  // review-then-save contract (ADR 0015): the select below carries it.
  const linking = profile.resumeId !== resume.id;
  if (draft.changed.length === 0 && !linking) {
    const note = draft.warnings[0] ? ` — ${draft.warnings[0]}` : '';
    return flashRedirect(
      '/settings?tab=profile',
      'ok',
      `"${profile.name}" already matches resume "${resume.name}"${note}.`,
    );
  }

  const props = await loadSettingsProps();
  return c.html(
    <SettingsPage
      {...props}
      activeTab="profile"
      flash={null}
      activeProfile={{ ...profile, ...draft.changes, resumeId: resume.id }}
      profileDraft={{
        resumeName: resume.name,
        changed: linking ? [...draft.changed, 'resume for this search'] : draft.changed,
        warnings: draft.warnings,
      }}
    />,
  );
});

// --- Re-classify ------------------------------------------------------------
// Reached only through "Save & re-classify" in the profile editor — the
// standalone top-row button was removed (docs/onboarding-plan.md §3).

/** An optional `<select>` of row ids: "" (the "none" option) and junk both mean null. */
function optionalId(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function triggerReclassifyAsync(): void {
  if (reclassifyInFlight) return;
  reclassifyInFlight = true;
  void (async () => {
    try {
      await recordCronRun('reclassify-all', runReclassifyAll);
    } catch (err) {
      logger.error({ err }, 'reclassify-all: failed');
    } finally {
      reclassifyInFlight = false;
    }
  })();
}
