/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { AtsType } from '@prisma/client';
import { z } from 'zod';
import { logger } from '../../logger';
import {
  addTelegramTarget,
  deleteTelegramTarget,
  getSettings,
  listTelegramTargets,
  maskToken,
  setAiEngineConfig,
  setApplicationTrackingEnabled,
  setClassifierMode,
  setDisabledSources,
  setFetchingEnabled,
  setStaleApplicationsDigestEnabled,
  setTelegramEnabled,
  testTelegramTarget,
  toggleTelegramTarget,
} from '../../settings';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  PROVIDER_MODEL_OPTIONS,
  defaultModelFor,
  isAiProviderId,
  modelFitsProvider,
  parseAiEngineConfig,
  resolveAiEngine,
  type AiEngineConfig,
  type AiProviderId,
} from '../../ai-engine';
import { getAiEngineEnv, probeAiProviders } from '../../ai-runtime';
import { getAiProviderById } from '../../ai-provider';
import {
  createProfile,
  deleteProfile,
  getActiveProfile,
  getProfile,
  listProfiles,
  setActiveProfile,
  updateProfile,
} from '../../profiles';
import { runReclassifyAll } from '../../jobs/reclassify-job';
import { recordCronRun } from '../../jobs/cron-run';
import { parseTagList, toStringArray } from '../../text-utils';
import {
  formatPriorityRulesText,
  parsePriorityRules,
  parsePriorityRulesText,
} from '../../priority-rules';
import { prisma } from '../../db';
import { isSettingsTab, SettingsPage } from '../pages/settings';
import { sourceLabel } from '../source-names';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { getResume, listResumes } from '../../resume/store';
import { scanResume } from '../../resume/scan';
import { buildProfileDraft } from '../../resume/profile-draft';

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
  remoteOk: z.string().optional(),
  remoteRegions: z.union([z.string(), z.array(z.string())]).optional(),
  onsiteCities: z.string().optional().default(''),
  hybridOk: z.string().optional(),
  minSalaryUsd: z.coerce.number().int().min(0).default(0),
  minFitScore: z.coerce.number().int().min(0).max(100).default(70),
  telegramTargetId: z.string().optional().default(''),
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

const ENGINE_TEST_TIMEOUT_MS = 90_000;

let reclassifyInFlight = false;

export const settingsRoute = new Hono();

/** Everything the settings page needs except activeTab/flash/profileDraft —
 *  shared by the GET and by POSTs that render a draft instead of redirecting. */
async function loadSettingsProps() {
  const [settings, targets, profiles, active, resumes, aiStatuses] = await Promise.all([
    getSettings(),
    listTelegramTargets(),
    listProfiles(),
    getActiveProfile(),
    listResumes(),
    probeAiProviders(),
  ]);
  const aiEnv = getAiEngineEnv();
  const engine = resolveAiEngine(settings.aiEngine, aiEnv);
  const aiConfig = parseAiEngineConfig(settings.aiEngine);
  // With no stored config the .env-seeded chain is shown as enabled.
  const enabledOrder = aiConfig.order.length > 0 ? aiConfig.order : engine.chain;
  const aiEngines = AI_PROVIDER_IDS.map((id) => {
    const position = enabledOrder.indexOf(id);
    const classifierDefault = defaultModelFor(id, 'classifier', aiEnv) || 'CLI default';
    const resumeDefault = defaultModelFor(id, 'resume', aiEnv) || 'CLI default';
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
      classifierDefault,
      resumeDefault,
      options: PROVIDER_MODEL_OPTIONS[id],
      freeTextModels: id === 'openai_api',
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
  };
  return {
    telegramEnabled: settings.telegramEnabled,
    classifierMode: settings.classifierMode,
    applicationTrackingEnabled: settings.applicationTrackingEnabled,
    staleApplicationsDigestEnabled: settings.staleApplicationsDigestEnabled,
    disabledSources: settings.disabledSources,
    allSources: Object.values(AtsType).filter((t) => t !== AtsType.MANUAL),
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
      stackPreview:
        p.stackRequired.slice(0, 4).join(', ') +
        (p.stackRequired.length > 4 ? '...' : ''),
      active: active?.id === p.id,
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
  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(<SettingsPage {...props} activeTab={activeTab} flash={flash} />, 200, {
    'Set-Cookie': clearFlashCookie(),
  });
});

// --- Fetching pause / resume -----------------------------------------------

settingsRoute.post('/settings/fetching-toggle', async (c) => {
  const settings = await getSettings();
  await setFetchingEnabled(!settings.fetchingEnabled);
  return settings.fetchingEnabled
    ? flashRedirect('/settings?tab=general', 'warn', 'Job fetching paused — no new jobs or alerts until you resume.')
    : flashRedirect('/settings?tab=general', 'ok', 'Job fetching resumed — next hourly tick will pull new jobs.');
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
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', 'Unknown engine.');
  const label = AI_PROVIDER_LABELS[provider];
  const classifier = cleanModelId(form.classifier);
  const resume = cleanModelId(form.resume);
  for (const model of [classifier, resume]) {
    if (model && !modelFitsProvider(model, provider)) {
      return flashRedirect(
        '/settings?tab=ai',
        'err',
        `"${model}" is not a ${label} model id. Nothing saved.`,
      );
    }
  }
  const { config } = await readAiOrder();
  await setAiEngineConfig({
    ...config,
    models: { ...config.models, [provider]: { classifier, resume } },
  });
  return flashRedirect('/settings?tab=ai', 'ok', `${label} models saved.`);
});

settingsRoute.post('/settings/ai/test', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', 'Unknown engine.');
  const label = AI_PROVIDER_LABELS[provider];
  let backend;
  try {
    backend = getAiProviderById(provider);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=ai',
      'err',
      `${label} test failed: ${err instanceof Error ? err.message : 'not configured'}.`,
    );
  }
  const settings = await getSettings();
  const engine = resolveAiEngine(settings.aiEngine, getAiEngineEnv());
  const model = engine.modelFor(provider, 'classifier');
  const started = Date.now();
  const text = await backend.complete({
    system: 'You are a connectivity test. Reply with exactly: OK',
    user: 'Reply with exactly: OK',
    maxTokens: 20,
    label: 'engine-test',
    model,
    timeoutMs: ENGINE_TEST_TIMEOUT_MS,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (text !== null) {
    return flashRedirect(
      '/settings?tab=ai',
      'ok',
      `${label} works — replied in ${seconds}s (model ${model || 'CLI default'}).`,
    );
  }
  return flashRedirect(
    '/settings?tab=ai',
    'err',
    `${label} test failed after ${seconds}s — see the web container logs for the reason.`,
  );
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
  const profile = await createProfile({
    name: 'New profile',
    stackRequired: [],
    roleTypes: [],
    stackNiceToHave: [],
    stackExclude: ['junior', 'intern'],
    notes: null,
    seniority: ['senior'],
    remoteOk: true,
    remoteRegions: ['US'],
    onsiteCities: [],
    hybridOk: false,
    minSalaryUsd: 0,
    minFitScore: 70,
    telegramTargetId: null,
    priorityRules: [],
  });
  await setActiveProfile(profile.id);
  return flashRedirect(
    '/settings?tab=profile',
    'ok',
    'New profile created and activated. Edit the fields below and save.',
  );
});

settingsRoute.post('/settings/profiles/activate', async (c) => {
  const form = await c.req.parseBody();
  const id = Number(form.id);
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', 'Invalid id.');
  try {
    await setActiveProfile(id);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      err instanceof Error ? err.message : 'Failed to activate.',
    );
  }
  return flashRedirect(
    '/settings?tab=profile',
    'ok',
    'Profile activated. Click "Re-classify all jobs" to score them with this profile.',
  );
});

settingsRoute.post('/settings/profiles/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  try {
    await deleteProfile(id);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      err instanceof Error ? err.message : 'Delete failed.',
    );
  }
  return flashRedirect('/settings?tab=profile', 'ok', 'Profile deleted.');
});

settingsRoute.post('/settings/profiles/:id/save', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await getProfile(id))) {
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

  const telegramTargetId =
    f.telegramTargetId && f.telegramTargetId.length > 0
      ? Number(f.telegramTargetId)
      : null;

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

  await updateProfile(id, {
    name: f.name,
    stackRequired: parseTagList(f.stackRequired),
    roleTypes: parseTagList(f.roleTypes),
    stackNiceToHave: parseTagList(f.stackNiceToHave),
    stackExclude: parseTagList(f.stackExclude),
    notes: f.notes && f.notes.trim().length > 0 ? f.notes.trim() : null,
    seniority: toStringArray(f.seniority),
    remoteOk: f.remoteOk === '1',
    remoteRegions: toStringArray(f.remoteRegions),
    onsiteCities: parseTagList(f.onsiteCities),
    hybridOk: f.hybridOk === '1',
    minSalaryUsd: f.minSalaryUsd,
    minFitScore: f.minFitScore,
    telegramTargetId:
      telegramTargetId !== null && Number.isFinite(telegramTargetId)
        ? telegramTargetId
        : null,
    priorityRules,
  });

  if (f.action === 'save-and-reclassify') {
    triggerReclassifyAsync();
    return flashRedirect(
      '/settings?tab=profile',
      'ok',
      'Profile saved. Re-classify started in the background — track progress at /runs.',
    );
  }
  return flashRedirect('/settings?tab=profile', 'ok', 'Profile saved.');
});

// Prefill the editor from a resume's AI scan. Renders the draft directly —
// nothing is saved until the user submits the profile form.
settingsRoute.post('/settings/profiles/:id/fill-from-resume', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const profile = await getProfile(id);
  if (!profile) return flashRedirect('/settings?tab=profile', 'err', 'Profile not found.');
  const form = await c.req.parseBody();
  const resumeId = Number(form.resumeId);
  if (!Number.isFinite(resumeId)) {
    return flashRedirect('/settings?tab=profile', 'err', 'Pick a resume first.');
  }
  let resume = await getResume(resumeId);
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
    resume = (await getResume(resumeId)) ?? resume;
  }

  const draft = buildProfileDraft(profile, {
    title: resume.title,
    seniority: resume.seniority,
    skills: resume.skills,
    primarySkills: resume.primarySkills,
    roleTypes: resume.roleTypes,
  });
  if (draft.changed.length === 0) {
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
      activeProfile={{ ...profile, ...draft.changes }}
      profileDraft={{
        resumeName: resume.name,
        changed: draft.changed,
        warnings: draft.warnings,
      }}
    />,
  );
});

// --- Re-classify ------------------------------------------------------------

settingsRoute.post('/settings/reclassify', (c) => {
  if (reclassifyInFlight) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      'A re-classify is already running. Watch /runs for progress.',
    );
  }
  triggerReclassifyAsync();
  return flashRedirect(
    '/settings?tab=profile',
    'ok',
    'Re-classify started in the background. Track progress at /runs.',
  );
});

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
