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
  setAiEngine,
  setApplicationTrackingEnabled,
  setClassifierMode,
  setDisabledSources,
  setDiscoveryEnabled,
  setFetchingEnabled,
  setHnParserEnabled,
  setStaleApplicationsDigestEnabled,
  setTelegramEnabled,
  testTelegramTarget,
  toggleTelegramTarget,
} from '../../settings';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  isAiProviderId,
  modelFitsProvider,
  resolveAiEngine,
  type AiProviderId,
} from '../../ai-engine';
import { AI_ENGINE_ENV, probeAiProviders } from '../../ai-runtime';
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
import { runHnHiringJob } from '../../jobs/hn-hiring-job';
import { recordCronRun } from '../../jobs/cron-run';
import { parseTagList, toStringArray } from '../../text-utils';
import {
  formatPriorityRulesText,
  parsePriorityRules,
  parsePriorityRulesText,
} from '../../priority-rules';
import { prisma } from '../../db';
import { SettingsPage } from '../pages/settings';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { listResumes } from '../../resume/store';

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
};

let reclassifyInFlight = false;

export const settingsRoute = new Hono();

settingsRoute.get('/settings', async (c) => {
  const [settings, targets, profiles, active, resumes, aiStatuses] = await Promise.all([
    getSettings(),
    listTelegramTargets(),
    listProfiles(),
    getActiveProfile(),
    listResumes(),
    probeAiProviders(),
  ]);
  const aiEffective = resolveAiEngine(settings, AI_ENGINE_ENV);
  const aiFamilyDefaults = resolveAiEngine(
    { aiProvider: settings.aiProvider, aiModelClassifier: null, aiModelResume: null },
    AI_ENGINE_ENV,
  );
  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(
    <SettingsPage
      telegramEnabled={settings.telegramEnabled}
      classifierMode={settings.classifierMode}
      applicationTrackingEnabled={settings.applicationTrackingEnabled}
      staleApplicationsDigestEnabled={settings.staleApplicationsDigestEnabled}
      hnParserEnabled={settings.hnParserEnabled}
      disabledSources={settings.disabledSources}
      allSources={Object.values(AtsType).filter((t) => t !== AtsType.MANUAL)}
      discoveryEnabled={settings.discoveryEnabled}
      fetchingEnabled={settings.fetchingEnabled}
      aiProviders={AI_PROVIDER_IDS.map((id) => ({
        id,
        label: AI_PROVIDER_LABELS[id],
        desc: AI_PROVIDER_DESCS[id],
        ok: aiStatuses[id].ok,
        detail: aiStatuses[id].detail,
        selected: aiEffective.providerId === id,
      }))}
      aiModelClassifier={settings.aiModelClassifier}
      aiModelResume={settings.aiModelResume}
      aiDefaults={{
        classifier: aiFamilyDefaults.classifierModel,
        resume: aiFamilyDefaults.resumeModel,
      }}
      targets={targets.map((t) => ({
        id: t.id,
        name: t.name,
        maskedToken: maskToken(t.botToken),
        chatId: t.chatId,
        active: t.active,
        createdAt: t.createdAt,
        lastUsed: t.lastUsed,
      }))}
      profiles={profiles.map((p) => ({
        id: p.id,
        name: p.name,
        stackPreview:
          p.stackRequired.slice(0, 4).join(', ') +
          (p.stackRequired.length > 4 ? '...' : ''),
        active: active?.id === p.id,
      }))}
      activeProfile={active}
      availableTargets={targets.map((t) => ({
        id: t.id,
        name: t.name,
        active: t.active,
      }))}
      resumes={resumes.map((r) => ({
        id: r.id,
        name: r.name,
        isDefault: r.isDefault,
        scannedAt: r.scannedAt,
      }))}
      flash={flash}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

// --- Fetching pause / resume -----------------------------------------------

settingsRoute.post('/settings/fetching-toggle', async (c) => {
  const settings = await getSettings();
  await setFetchingEnabled(!settings.fetchingEnabled);
  return flashRedirect(
    '/settings',
    'ok',
    settings.fetchingEnabled
      ? 'Job fetching paused — no new jobs or alerts until you resume.'
      : 'Job fetching resumed — next hourly tick will pull new jobs.',
  );
});

// --- Telegram toggle / targets ---------------------------------------------

settingsRoute.post('/settings/telegram-toggle', async (c) => {
  const settings = await getSettings();
  await setTelegramEnabled(!settings.telegramEnabled);
  return flashRedirect(
    '/settings',
    'ok',
    `Telegram alerts ${!settings.telegramEnabled ? 'enabled' : 'disabled'}.`,
  );
});

settingsRoute.post('/settings/ai', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) {
    return flashRedirect('/settings', 'err', 'Pick an AI provider.');
  }
  const statuses = await probeAiProviders();
  if (!statuses[provider].ok) {
    return flashRedirect(
      '/settings',
      'err',
      `${AI_PROVIDER_LABELS[provider]} is not usable here: ${statuses[provider].detail}.`,
    );
  }
  const classifierModel = cleanModelId(form.classifierModel);
  const resumeModel = cleanModelId(form.resumeModel);
  for (const model of [classifierModel, resumeModel]) {
    if (model && !modelFitsProvider(model, provider)) {
      return flashRedirect(
        '/settings',
        'err',
        `"${model}" does not look like a ${AI_PROVIDER_LABELS[provider]} model id. Not saved.`,
      );
    }
  }
  await setAiEngine({ aiProvider: provider, aiModelClassifier: classifierModel, aiModelResume: resumeModel });
  return flashRedirect(
    '/settings',
    'ok',
    `AI engine → ${AI_PROVIDER_LABELS[provider]}. Dashboard actions use it now; the worker follows on its next tick.`,
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
  return flashRedirect('/settings', 'ok', `Classifier mode → ${label}.`);
});

settingsRoute.post('/settings/application-tracking-toggle', async (c) => {
  const settings = await getSettings();
  await setApplicationTrackingEnabled(!settings.applicationTrackingEnabled);
  return flashRedirect(
    '/settings',
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
    '/settings',
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
  const allSources = Object.values(AtsType) as string[];
  // disabledSources = everything NOT in the submitted "enabled" set.
  const disabled = allSources.filter((s) => !enabled.includes(s));
  await setDisabledSources(disabled);
  return flashRedirect(
    '/settings',
    'ok',
    disabled.length === 0
      ? 'All sources enabled.'
      : `Disabled: ${disabled.join(', ')}.`,
  );
});

settingsRoute.post('/settings/discovery-toggle', async (c) => {
  const settings = await getSettings();
  await setDiscoveryEnabled(!settings.discoveryEnabled);
  return flashRedirect(
    '/settings',
    'ok',
    `Auto-discovery ${!settings.discoveryEnabled ? 'enabled' : 'disabled'}.`,
  );
});

settingsRoute.post('/settings/hn-parser-toggle', async (c) => {
  const settings = await getSettings();
  await setHnParserEnabled(!settings.hnParserEnabled);
  return flashRedirect(
    '/settings',
    'ok',
    `HN parser ${!settings.hnParserEnabled ? 'enabled' : 'disabled'}.`,
  );
});

let hnRunInFlight = false;
settingsRoute.post('/settings/hn-run', (c) => {
  if (hnRunInFlight) {
    return flashRedirect(
      '/settings',
      'err',
      'An HN parse run is already in progress. Watch /runs.',
    );
  }
  hnRunInFlight = true;
  void (async () => {
    try {
      await recordCronRun('hn-hiring', runHnHiringJob);
    } catch (err) {
      logger.error({ err }, 'hn-hiring (manual trigger): failed');
    } finally {
      hnRunInFlight = false;
    }
  })();
  return flashRedirect(
    '/settings',
    'ok',
    'HN parse started in the background. Track progress at /runs.',
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
    return flashRedirect('/settings', 'err', 'Invalid input — name, token, chat id required.');
  }
  const test = await testTelegramTarget(parsed.data.botToken, parsed.data.chatId);
  if (!test.ok) {
    return flashRedirect(
      '/settings',
      'err',
      `Validation failed: ${test.error ?? 'unknown'}`,
    );
  }
  await addTelegramTarget(parsed.data);
  return flashRedirect(
    '/settings',
    'ok',
    `Added target "${parsed.data.name}" (bot @${test.botUsername ?? '?'}). Test message sent.`,
  );
});

settingsRoute.post('/settings/targets/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await toggleTelegramTarget(id);
  return flashRedirect('/settings', 'ok', 'Target toggled.');
});

settingsRoute.post('/settings/targets/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await deleteTelegramTarget(id);
  return flashRedirect('/settings', 'ok', 'Target deleted.');
});

settingsRoute.post('/settings/targets/:id/test', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const t = await prisma.telegramTarget.findUnique({ where: { id } });
  if (!t) return flashRedirect('/settings', 'err', 'Target not found.');
  const result = await testTelegramTarget(t.botToken, t.chatId);
  if (result.ok) {
    return flashRedirect(
      '/settings',
      'ok',
      `Test sent to "${t.name}" (bot @${result.botUsername ?? '?'}).`,
    );
  }
  return flashRedirect('/settings', 'err', `Test failed: ${result.error ?? 'unknown'}`);
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
    '/settings',
    'ok',
    'New profile created and activated. Edit the fields below and save.',
  );
});

settingsRoute.post('/settings/profiles/activate', async (c) => {
  const form = await c.req.parseBody();
  const id = Number(form.id);
  if (!Number.isFinite(id)) return flashRedirect('/settings', 'err', 'Invalid id.');
  try {
    await setActiveProfile(id);
  } catch (err) {
    return flashRedirect(
      '/settings',
      'err',
      err instanceof Error ? err.message : 'Failed to activate.',
    );
  }
  return flashRedirect(
    '/settings',
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
      '/settings',
      'err',
      err instanceof Error ? err.message : 'Delete failed.',
    );
  }
  return flashRedirect('/settings', 'ok', 'Profile deleted.');
});

settingsRoute.post('/settings/profiles/:id/save', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await getProfile(id))) {
    return flashRedirect('/settings', 'err', 'Profile not found.');
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
    return flashRedirect('/settings', 'err', 'Invalid form values.');
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
      '/settings',
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
      '/settings',
      'ok',
      'Profile saved. Re-classify started in the background — track progress at /runs.',
    );
  }
  return flashRedirect('/settings', 'ok', 'Profile saved.');
});

// --- Re-classify ------------------------------------------------------------

settingsRoute.post('/settings/reclassify', (c) => {
  if (reclassifyInFlight) {
    return flashRedirect(
      '/settings',
      'err',
      'A re-classify is already running. Watch /runs for progress.',
    );
  }
  triggerReclassifyAsync();
  return flashRedirect(
    '/settings',
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
