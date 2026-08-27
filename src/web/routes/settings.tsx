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

const FLASH_TTL_SECONDS = 5;

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

let reclassifyInFlight = false;

export const settingsRoute = new Hono();

settingsRoute.get('/settings', async (c) => {
  const [settings, targets, profiles, active] = await Promise.all([
    getSettings(),
    listTelegramTargets(),
    listProfiles(),
    getActiveProfile(),
  ]);
  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(
    <SettingsPage
      telegramEnabled={settings.telegramEnabled}
      classifierMode={settings.classifierMode}
      applicationTrackingEnabled={settings.applicationTrackingEnabled}
      staleApplicationsDigestEnabled={settings.staleApplicationsDigestEnabled}
      hnParserEnabled={settings.hnParserEnabled}
      disabledSources={settings.disabledSources}
      allSources={Object.values(AtsType)}
      discoveryEnabled={settings.discoveryEnabled}
      fetchingEnabled={settings.fetchingEnabled}
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
  return redirectWithFlash(
    c,
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
  return redirectWithFlash(
    c,
    'ok',
    `Telegram alerts ${!settings.telegramEnabled ? 'enabled' : 'disabled'}.`,
  );
});

settingsRoute.post('/settings/classifier-mode', async (c) => {
  const form = await c.req.parseBody();
  const raw = form.mode;
  const mode = raw === 'two_stage' ? 'two_stage' : 'single';
  await setClassifierMode(mode);
  const label =
    mode === 'two_stage'
      ? 'Two-stage prefilter + Haiku 4.5'
      : 'Single (Haiku 4.5 only)';
  return redirectWithFlash(c, 'ok', `Classifier mode → ${label}.`);
});

settingsRoute.post('/settings/application-tracking-toggle', async (c) => {
  const settings = await getSettings();
  await setApplicationTrackingEnabled(!settings.applicationTrackingEnabled);
  return redirectWithFlash(
    c,
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
  return redirectWithFlash(
    c,
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
  return redirectWithFlash(
    c,
    'ok',
    disabled.length === 0
      ? 'All sources enabled.'
      : `Disabled: ${disabled.join(', ')}.`,
  );
});

settingsRoute.post('/settings/discovery-toggle', async (c) => {
  const settings = await getSettings();
  await setDiscoveryEnabled(!settings.discoveryEnabled);
  return redirectWithFlash(
    c,
    'ok',
    `Auto-discovery ${!settings.discoveryEnabled ? 'enabled' : 'disabled'}.`,
  );
});

settingsRoute.post('/settings/hn-parser-toggle', async (c) => {
  const settings = await getSettings();
  await setHnParserEnabled(!settings.hnParserEnabled);
  return redirectWithFlash(
    c,
    'ok',
    `HN parser ${!settings.hnParserEnabled ? 'enabled' : 'disabled'}.`,
  );
});

let hnRunInFlight = false;
settingsRoute.post('/settings/hn-run', (c) => {
  if (hnRunInFlight) {
    return redirectWithFlash(
      c,
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
  return redirectWithFlash(
    c,
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
    return redirectWithFlash(c, 'err', 'Invalid input — name, token, chat id required.');
  }
  const test = await testTelegramTarget(parsed.data.botToken, parsed.data.chatId);
  if (!test.ok) {
    return redirectWithFlash(
      c,
      'err',
      `Validation failed: ${test.error ?? 'unknown'}`,
    );
  }
  await addTelegramTarget(parsed.data);
  return redirectWithFlash(
    c,
    'ok',
    `Added target "${parsed.data.name}" (bot @${test.botUsername ?? '?'}). Test message sent.`,
  );
});

settingsRoute.post('/settings/targets/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await toggleTelegramTarget(id);
  return redirectWithFlash(c, 'ok', 'Target toggled.');
});

settingsRoute.post('/settings/targets/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await deleteTelegramTarget(id);
  return redirectWithFlash(c, 'ok', 'Target deleted.');
});

settingsRoute.post('/settings/targets/:id/test', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const t = await prisma.telegramTarget.findUnique({ where: { id } });
  if (!t) return redirectWithFlash(c, 'err', 'Target not found.');
  const result = await testTelegramTarget(t.botToken, t.chatId);
  if (result.ok) {
    return redirectWithFlash(
      c,
      'ok',
      `Test sent to "${t.name}" (bot @${result.botUsername ?? '?'}).`,
    );
  }
  return redirectWithFlash(c, 'err', `Test failed: ${result.error ?? 'unknown'}`);
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
  return redirectWithFlash(
    c,
    'ok',
    'New profile created and activated. Edit the fields below and save.',
  );
});

settingsRoute.post('/settings/profiles/activate', async (c) => {
  const form = await c.req.parseBody();
  const id = Number(form.id);
  if (!Number.isFinite(id)) return redirectWithFlash(c, 'err', 'Invalid id.');
  try {
    await setActiveProfile(id);
  } catch (err) {
    return redirectWithFlash(
      c,
      'err',
      err instanceof Error ? err.message : 'Failed to activate.',
    );
  }
  return redirectWithFlash(
    c,
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
    return redirectWithFlash(
      c,
      'err',
      err instanceof Error ? err.message : 'Delete failed.',
    );
  }
  return redirectWithFlash(c, 'ok', 'Profile deleted.');
});

settingsRoute.post('/settings/profiles/:id/save', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await getProfile(id))) {
    return redirectWithFlash(c, 'err', 'Profile not found.');
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
    return redirectWithFlash(c, 'err', 'Invalid form values.');
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
    return redirectWithFlash(
      c,
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
    return redirectWithFlash(
      c,
      'ok',
      'Profile saved. Re-classify started in the background — track progress at /runs.',
    );
  }
  return redirectWithFlash(c, 'ok', 'Profile saved.');
});

// --- Re-classify ------------------------------------------------------------

settingsRoute.post('/settings/reclassify', (c) => {
  if (reclassifyInFlight) {
    return redirectWithFlash(
      c,
      'err',
      'A re-classify is already running. Watch /runs for progress.',
    );
  }
  triggerReclassifyAsync();
  return redirectWithFlash(
    c,
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

// --- helpers ----------------------------------------------------------------

import type { Context } from 'hono';

function redirectWithFlash(
  c: Context,
  kind: 'ok' | 'err',
  text: string,
): Response {
  const value = encodeURIComponent(JSON.stringify({ kind, text }));
  const cookie = `flash=${value}; Path=/; Max-Age=${FLASH_TTL_SECONDS}; HttpOnly; SameSite=Lax`;
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/settings',
      'Set-Cookie': cookie,
    },
  });
}

function parseFlashCookie(
  cookieHeader: string | undefined,
): { kind: 'ok' | 'err'; text: string } | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)flash=([^;]+)/.exec(cookieHeader);
  if (!match || !match[1]) return null;
  try {
    const decoded = decodeURIComponent(match[1]);
    const parsed = JSON.parse(decoded);
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.kind === 'ok' || parsed.kind === 'err') &&
      typeof parsed.text === 'string'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function clearFlashCookie(): string {
  return 'flash=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
}
