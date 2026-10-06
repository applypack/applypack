/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { idParam } from '../params';
import { onceGuard } from '../once-guard';
import { AtsType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { logger } from '../../logger';
import {
  addNotificationTarget,
  findSameDestination,
  deleteNotificationTarget,
  getAiKeys,
  getSchedule,
  getSettings,
  listNotificationTargets,
  maskToken,
  setAiBudgetCents,
  setAiEngineConfig,
  setAiKey,
  setApplicationTrackingEnabled,
  setClassifierMode,
  setDisabledSources,
  setFetchingEnabled,
  setPipelineStages,
  setSourceHealthAlerts,
  setStaleApplicationsDigestEnabled,
  setLocalAiUrl,
  setLocalContextTokens,
  setOpenAiBaseUrl,
  setPackSettings,
  setReapplyDays,
  setUpdateCheck,
  setTelegramEnabled,
  testTelegramTarget,
  toggleNotificationTarget,
  getSourceKeys,
  setSourceKey,
  setSchedule,
  setEmployerMode,
  setLocale,
  setScreeningRetentionDays,
  SCREENING_RETENTION_DAYS,
  SETTINGS_ID,
  withGlobalWriteLock,
} from '../../settings';
import { setEmployerModeCache } from '../employer-mode';
import { applicantNotice, LEGAL_NOTE } from '../../screening/notice';
import { config } from '../../config';
import { ALL_DAYS, MAX_DIGEST_HOURS, ScheduleSchema, describeSchedule, parseSchedule } from '../../user-schedule';
import { loadHeldLine, loadNextCheck } from '../schedule-view';
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
  aiEngineCard,
  aiEngineOrder,
  defaultModelFor,
  isAiProviderId,
  modelFitsProvider,
  offeredTasks,
  parseAiEngineConfig,
  resolveAiEngine,
  toggleAiEngine,
  withEngineTasks,
  type AiEngineConfig,
  type AiProviderId,
} from '../../ai-engine';
import { AI_TASKS, AI_TASK_LABELS, isAiTask } from '../../ai-tasks';
import { aiPlanRows, pickedTasks, taskShown, tasksSaved } from '../ai-plan';
import { billingFacts, forgetAiProbe, getAiEngineEnv, localAiBase, openAiBase, probeAiProviders } from '../../ai-runtime';
import { DEFAULT_LOCAL_CONTEXT_TOKENS, LOCAL_CONTEXT_CHOICES } from '../../ai-provider-parse';
import { knownModels } from '../../server-models';
import { loginItemState, setLoginItem } from '../login-item-io';
import { APP_VERSION } from '../../app-version';
import { checkForUpdate } from '../../update-check';
import { isNewer } from '../../versions';
import { isReapplyChoice } from '../../employer';
import { forgetUpdateNotice } from '../update-notice';
import { billingOf, checkLocalAiUrl, checkOpenAiBaseUrl, isLocalUrl, type AiBilling } from '../../ai-usage';
import { billingNotes } from '../../ai-spend';
import { billedThisMonth } from '../../ai-ledger';
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
import { groupSources, type SourceCount, fetchedSource } from '../source-groups';
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
import { isSettingsTab, SettingsPage, type EngineServer, type SourceKeyRow } from '../pages/settings';
import { packSettingsFromForm, parsePackSettings } from '../../pack/settings';
import { sourceLabel } from '../source-names';
import { clearFlashCookie, firstIssue, flashRedirect, parseFlashCookie, refusedField, safeBack } from '../flash';
import { isSelectableLocale, withLocale } from '../../i18n/locale';
import { t } from '../../i18n/t';
import { describeDestination } from '../../notify/targets';
import { isDiscordWebhookUrl, testDiscordWebhook } from '../../notify/discord';
import { missingLinkMessage } from '../profile-links';
import { createResume, getResume, listResumes } from '../../resume/store';
import { scanResume } from '../../resume/scan';
import { buildProfileDraft } from '../../resume/profile-draft';
import { nameFromFilename, readResumeUpload, resumeUploadLimit } from '../upload';

/*
 * A flash that refuses says what it refused, what is safe and what to do next.
 * The first two answer a request the page's own forms cannot send, the third a
 * page gone stale — so the way forward is the page as it is now.
 */
const UNKNOWN_ENGINE = 'That request named an engine this version does not know, so nothing changed. Reload the page and use its buttons.';
const UNKNOWN_SEARCH = 'That request named no search, so nothing changed. Reload the page and use its buttons.';
const SEARCH_GONE = 'That search no longer exists, so nothing was saved. Pick one under Searches below.';

const testFailed = (name: string, reason: string | undefined): string =>
  `The test message to "${name}" did not go through (${reason ?? 'no reason given'}). The target is unchanged; check its token or URL, or delete it and add it again.`;

const TelegramTargetSchema = z.object({
  name: z.string().min(1).max(100),
  botToken: z.string().min(20).max(200),
  chatId: z.string().min(1).max(100),
});

const DiscordTargetSchema = z.object({
  name: z.string().min(1).max(100),
  webhookUrl: z.string().min(20).max(400).refine(isDiscordWebhookUrl, 'not a Discord webhook URL'),
});

const ProfileFormSchema = z.object({
  name: z.string().min(1).max(100),
  stackRequired: z.string().optional().default(''),
  roleTypes: z.string().optional().default(''),
  stackNiceToHave: z.string().optional().default(''),
  stackExclude: z.string().optional().default(''),
  notes: z.string().max(4_000).optional().default(''),
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
  notificationTargetId: z.string().optional().default(''),
  resumeId: z.string().optional().default(''),
  priorityRules: z.string().optional().default(''),
  action: z.string().optional(),
});

// UI copy per backend; availability comes from probeAiProviders().
const AI_PROVIDER_DESCS: Record<AiProviderId, string> = {
  anthropic_api: 'Messages API: fastest, pays per token.',
  claude_code: 'Headless claude -p on your Claude.ai subscription. Slower, no per-token bill.',
  gemini_cli: 'Headless gemini -p on your Google account or GEMINI_API_KEY.',
  agy_cli: 'Headless agy -p on your Google Antigravity account.',
  openai_api:
    'Any server speaking /chat/completions: OpenAI, OpenRouter, Groq, local LM Studio / Ollama. Pays per token (or free locally).',
  codex_cli: 'Headless codex exec on your ChatGPT subscription.',
  local_api:
    'Ollama on this machine, through its own API: the context window set per call, JSON mode, one call at a time. Free, private, slower; the text never leaves.',
};

let reclassifyInFlight = false;

/** Where the language is chosen on Settings: the switcher's way back when a form names none. */
const LANGUAGE_SECTION = '/settings?tab=general#language';

export const settingsRoute = new Hono();

/** Everything the settings page needs except activeTab/flash/profileDraft —
 *  shared by the GET and by POSTs that render a draft instead of redirecting. */

/**
 * The zone picker's options: every IANA zone the runtime knows, plus the
 * stored one if this Node build has never heard of it (so a schedule saved
 * on another machine is not silently rewritten by the select).
 */
function supportedTimezones(current: string): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes(current) ? [...zones] : [current, ...zones];
}

/** Engine cards: the list in priority order, then the last resort (it serves), then the rest. */
function cardRank(e: { enabled: boolean; position: number; lastResort: boolean }): number {
  if (e.enabled) return e.position;
  return e.lastResort ? AI_PROVIDER_IDS.length : AI_PROVIDER_IDS.length + 1;
}

async function loadSettingsProps() {
  // The keys are read once and lent to the probe — both need them (ADR 0027).
  const aiKeys = await getAiKeys();
  const [settings, targets, profiles, active, resumes, aiStatuses, stageCounts, billedMonth] =
    await Promise.all([
      getSettings(),
      listNotificationTargets(),
      listProfiles(),
      getActiveProfile(),
      listResumes(),
      probeAiProviders(aiKeys),
      prisma.job.groupBy({
        by: ['pipelineStage'],
        _count: { _all: true },
        where: { pipelineStage: { not: null } },
      }),
      billedThisMonth(),
    ]);
  const check = await loadNextCheck(settings.schedule);
  const scheduleView = {
    schedule: check.schedule,
    zones: supportedTimezones(check.schedule.timezone),
    nextFetch: check.next,
    held: await loadHeldLine(check.schedule),
    unsaved: settings.schedule === null,
  };
  const countByStage = new Map(
    stageCounts.map((row) => [row.pipelineStage, row._count._all]),
  );
  const { openAiBaseUrl } = settings;
  const openAiServer = openAiBase(openAiBaseUrl);
  const localServer = localAiBase(settings.localAiUrl);
  const servers: Partial<Record<AiProviderId, EngineServer>> = {
    openai_api: {
      action: '/settings/ai/openai-base',
      envVar: 'OPENAI_BASE_URL',
      label: 'Server address',
      hint: 'Any server that speaks /chat/completions — OpenRouter, Groq, LM Studio (http://127.0.0.1:1234/v1). Test lists the models it runs.',
      more: 'Ollama is better through the Local model engine. From Docker, write host.docker.internal instead of 127.0.0.1.',
      value: openAiServer,
      stored: openAiBaseUrl !== null,
      local: isLocalUrl(openAiServer),
    },
    local_api: {
      action: '/settings/ai/local',
      envVar: 'OLLAMA_URL',
      label: 'Ollama address',
      hint: 'Ollama answers at http://127.0.0.1:11434 (from Docker: http://host.docker.internal:11434). Test lists the models it has pulled.',
      value: localServer,
      stored: settings.localAiUrl !== null,
      local: true,
      context: { value: settings.localContextTokens ?? DEFAULT_LOCAL_CONTEXT_TOKENS, choices: LOCAL_CONTEXT_CHOICES },
    },
  };
  const billing = billingFacts(aiKeys, openAiBaseUrl);
  const billingFor = (id: AiProviderId): AiBilling => billingOf(id, billing);
  const aiEnv = getAiEngineEnv(aiKeys, openAiBaseUrl);
  const engine = resolveAiEngine(settings.aiEngine, aiEnv);
  const aiConfig = parseAiEngineConfig(settings.aiEngine);
  const aiEngines = AI_PROVIDER_IDS.map((id) => {
    const classifierDefault = defaultModelFor(id, 'classifier', aiEnv) || 'CLI default';
    const resumeDefault = defaultModelFor(id, 'resume', aiEnv) || 'CLI default';
    const storedKey = providerTakesKey(id) ? aiKeys[id] : undefined;
    return {
      id,
      label: AI_PROVIDER_LABELS[id],
      desc: AI_PROVIDER_DESCS[id],
      ok: aiStatuses[id].ok,
      detail: aiStatuses[id].detail,
      ...aiEngineCard(engine, id, aiEnv.provider),
      tasks: AI_TASKS.filter((task) => taskShown(task, settings.employerMode)).map((task) => ({
        id: task,
        label: AI_TASK_LABELS[task],
        taken: engine.takes(id, task),
        offered: offeredTasks(id).includes(task),
      })),
      classifierModel: aiConfig.models[id]?.classifier ?? '',
      resumeModel: aiConfig.models[id]?.resume ?? '',
      coverModel: aiConfig.models[id]?.cover ?? '',
      classifierDefault,
      resumeDefault,
      // An empty cover slot takes the engine's own letter default, not the resume slot.
      coverDefault: defaultModelFor(id, 'cover', aiEnv) || 'CLI default',
      // TASKS S3: an OpenAI-compatible server's own models, as its last Test listed them.
      options: id === 'openai_api' ? knownModels(openAiServer) : id === 'local_api' ? knownModels(localServer) : PROVIDER_MODEL_OPTIONS[id],
      freeTextModels: id === 'openai_api' || id === 'local_api',
      server: servers[id] ?? null,
      billing: billingFor(id),
      // ADR 0027: the field takes a key, it never hands one back — only the
      // last four characters of what is stored, and where it came from.
      keyEnvVar: providerTakesKey(id) ? AI_KEY_ENV_VARS[id] : null,
      keySource: aiKeySource(id, aiKeys),
      maskedKey: storedKey ? maskToken(storedKey) : '',
    };
  }).sort((a, b) => cardRank(a) - cardRank(b));
  // What actually runs on this install, per family (#147): the enum is the
  // menu, the Company rows are the order.
  const sourceCounts: Record<string, SourceCount> = {};
  for (const row of await prisma.company.groupBy({ by: ['atsType', 'active'], _count: { _all: true } })) {
    const c = (sourceCounts[row.atsType] ??= { companies: 0, active: 0 });
    c.companies += row._count._all;
    if (row.active) c.active += row._count._all;
  }
  const keys = await getSourceKeys();
  const screeningCount = await prisma.screening.count();
  const screeningEngine = engine.chainFor('screening')[0]!;
  const plan = aiPlanRows(engine, billingFor, settings.employerMode);
  const aiStatus = {
    plan,
    skipped: engine.skipped.map((id) => AI_PROVIDER_LABELS[id]),
    billingNotes: billingNotes(plan),
  };
  const aiBudget = { cents: settings.aiBudgetCents, billedThisMonthMicro: billedMonth };
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
    reapplyDays: settings.reapplyDays,
    pack: parsePackSettings(settings.pack),
    loginItem: loginItemState(),
    updates: {
      enabled: settings.updateCheck,
      current: APP_VERSION,
      latest: settings.latestVersion,
      checkedAt: settings.latestCheckedAt,
    },
    sourceHealthAlerts: settings.sourceHealthAlerts,
    disabledSources: settings.disabledSources,
    hnParserEnabled: settings.hnParserEnabled,
    sourceGroups: groupSources(
      Object.values(AtsType).filter(fetchedSource),
      sourceCounts,
      KEYED_SOURCES.filter((s) => !sourceUnlocked(s, keys)),
    ),
    sourceKeyRows: sourceKeyRows(keys),
    fetchingEnabled: settings.fetchingEnabled,
    schedule: scheduleView,
    aiEngines,
    aiStatus,
    aiBudget,
    targets: targets.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      destination: describeDestination(t),
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
      kind: t.kind,
      active: t.active,
    })),
    resumes: resumes.map((r) => ({
      id: r.id,
      name: r.name,
      isDefault: r.isDefault,
      scannedAt: r.scannedAt,
    })),
    screening: {
      enabled: settings.employerMode,
      retentionDays: settings.screeningRetentionDays,
      retentionMin: SCREENING_RETENTION_DAYS.min,
      retentionMax: SCREENING_RETENTION_DAYS.max,
      engineLabel: AI_PROVIDER_LABELS[screeningEngine],
      engineSubscription: billingFor(screeningEngine) === 'plan',
      screenings: screeningCount,
      notice: applicantNotice(undefined, settings.screeningRetentionDays),
      legalNote: LEGAL_NOTE,
    },
  };
}

settingsRoute.get('/settings', async (c) => {
  const props = await loadSettingsProps();
  const tabParam = c.req.query('tab');
  const activeTab = isSettingsTab(tabParam) ? tabParam : 'general';
  // ?profile= points the editor at a specific (possibly inactive) profile.
  // "+ New profile" lands here: new profiles are born inactive (issue #50)
  // and must be editable before activation.
  const profileParam = idParam(c.req.query('profile'));
  if (Number.isFinite(profileParam)) {
    const editorProfile = await getProfile(profileParam);
    if (editorProfile) props.activeProfile = editorProfile;
  }
  const fill = idParam(c.req.query('fill'));
  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(<SettingsPage {...props} fillResumeId={Number.isFinite(fill) ? fill : undefined} activeTab={activeTab} flash={flash} />, 200, {
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
      'Job fetching resumed, but no running search has a required stack or role types — every fetched job goes to the AI classifier. Fill one in first (Settings → Searches).',
    );
  }
  return flashRedirect(back, 'ok', 'Job fetching resumed — next hourly tick will pull new jobs.');
});


/**
 * Saves the whole Schedule card (TASKS §16). Day and digest pills are
 * repeated checkboxes, so the body is read with `{ all: true }` (gotcha 1);
 * an empty day set would silence the search forever, so it falls back to
 * every day rather than saving nothing.
 */
settingsRoute.post('/settings/schedule', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const current = parseSchedule((await getSettings()).schedule, config.TZ);
  const candidate = {
    timezone: str(form.timezone) || current.timezone,
    fetch: {
      every: str(form.fetchEvery),
      from: hour(form.fetchFrom, current.fetch.from),
      to: hour(form.fetchTo, current.fetch.to),
      days: pills(form.fetchDays, ALL_DAYS),
    },
    alerts: {
      mode: str(form.alertMode),
      from: hour(form.alertFrom, current.alerts.from),
      to: hour(form.alertTo, current.alerts.to),
      days: pills(form.alertDays, ALL_DAYS),
      digestAt: pills(form.digestAt, current.alerts.digestAt).slice(0, MAX_DIGEST_HOURS),
    },
  };
  const parsed = ScheduleSchema.safeParse(candidate);
  if (!parsed.success) {
    return flashRedirect('/settings?tab=general', 'err', `Schedule not saved (${firstIssue(parsed.error.issues)}). The stored schedule is unchanged; fix that field and save again.`, refusedField(c.req.path, parsed.error.issues));
  }
  await setSchedule(parsed.data);
  const held = await loadHeldLine(parsed.data);
  const waiting = held === null ? '' : ` ${held.text}.`;
  return flashRedirect('/settings?tab=general', 'ok', `Schedule saved — ${describeSchedule(parsed.data)}.${waiting}`);
});

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** One hour select; anything unreadable keeps what was stored. */
function hour(value: unknown, fallback: number): number {
  const n = Number(str(value));
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

/** Repeated checkboxes → numbers. An empty set means the user unticked them all, which is never what they meant. */
function pills(value: unknown, fallback: readonly number[]): number[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const picked = raw.map((v) => Number(str(v))).filter((n) => Number.isInteger(n));
  return picked.length > 0 ? picked : [...fallback];
}

// --- Telegram toggle / targets ---------------------------------------------

settingsRoute.post('/settings/telegram-toggle', async (c) => {
  const settings = await getSettings();
  const enabled = !settings.telegramEnabled;
  await setTelegramEnabled(enabled);
  // Every channel, Discord included (ADR 0041) — the column is just old.
  const done = `Alerts ${enabled ? 'enabled' : 'disabled'} on every channel.`;
  const held = enabled ? await loadHeldLine(await getSchedule()) : null;
  return flashRedirect(
    '/settings?tab=notifications',
    'ok',
    enabled
      ? `${done}${held ? ` ${held.text}.` : ''}`
      : `${done} What is found meanwhile waits, and arrives in one message per chat when you switch them back on.`,
  );
});

/** The list the engine cards show (`aiEngineOrder`), the stored config, and the .env engine that seeds it. */
async function readAiOrder(): Promise<{
  order: AiProviderId[];
  config: AiEngineConfig;
  envProvider: AiProviderId;
}> {
  const settings = await getSettings();
  const config = parseAiEngineConfig(settings.aiEngine);
  const envProvider = getAiEngineEnv().provider;
  return { order: aiEngineOrder(config, envProvider), config, envProvider };
}

settingsRoute.post('/settings/ai/enable', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', UNKNOWN_ENGINE);
  const { order, config, envProvider } = await readAiOrder();
  const label = AI_PROVIDER_LABELS[provider];
  const next = toggleAiEngine(order, provider, envProvider);
  if (next === null) {
    return flashRedirect(
      '/settings?tab=ai',
      'warn',
      `${label} is the only engine in the list. Enable another one before you disable it.`,
    );
  }
  await setAiEngineConfig({ ...config, order: next });
  if (order.includes(provider)) {
    if (next.length === 0) {
      return flashRedirect(
        '/settings?tab=ai',
        'warn',
        `${label} disabled. Nothing is left in the list, so ${AI_PROVIDER_LABELS[envProvider]} (AI_PROVIDER in .env) takes its place.`,
      );
    }
    return flashRedirect('/settings?tab=ai', 'ok', `${label} disabled.`);
  }
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
  const [keys, { openAiBaseUrl }] = await Promise.all([getAiKeys(), getSettings()]);
  const billing = billingFacts(keys, openAiBaseUrl);
  if (billingOf(provider, billing) === 'billed' && next.slice(0, -1).some((id) => billingOf(id, billing) !== 'billed')) {
    return flashRedirect(
      '/settings?tab=ai',
      'warn',
      `${label} enabled as priority #${next.length}. It pays per token — it will spend money whenever the engines above it fail or run out of quota.`,
    );
  }
  return flashRedirect('/settings?tab=ai', 'ok', `${label} enabled as priority #${next.length}.`);
});

/** The monthly ceiling on billed AI money (ADR 0055): dollars in, cents stored; empty or 0 = none. */
const MAX_AI_BUDGET_USD = 100_000;

settingsRoute.post('/settings/ai/budget', async (c) => {
  const form = await c.req.parseBody();
  const raw = typeof form.budget === 'string' ? form.budget.trim() : '';
  const usd = raw === '' ? 0 : Number(raw);
  if (!Number.isFinite(usd) || usd < 0 || usd > MAX_AI_BUDGET_USD) {
    return flashRedirect('/settings?tab=ai#budget', 'err', `The budget is dollars a month, from 0 to ${MAX_AI_BUDGET_USD.toLocaleString('en-US')}; nothing was changed.`);
  }
  const cents = Math.round(usd * 100);
  await setAiBudgetCents(cents > 0 ? cents : null);
  return flashRedirect(
    '/settings?tab=ai#budget',
    'ok',
    cents > 0
      ? `Monthly budget set to $${(cents / 100).toFixed(2)}: a warning at 80 % and 100 % of billed spend, nothing stopped.`
      : 'Monthly budget removed.',
  );
});

settingsRoute.post('/settings/ai/move', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', UNKNOWN_ENGINE);
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

/** ADR 0060: the tasks an engine takes. Every box ticked is stored as no list, so the engine takes what a later version adds. */
settingsRoute.post('/settings/ai/tasks', async (c) => {
  // The boxes share one name (gotcha 1).
  const form = await c.req.parseBody({ all: true });
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) {
    return wantsJson ? c.json({ error: UNKNOWN_ENGINE }, 400) : flashRedirect('/settings?tab=ai', 'err', UNKNOWN_ENGINE);
  }
  const settings = await getSettings();
  const config = parseAiEngineConfig(settings.aiEngine);
  const picked = pickedTasks(toStringArray(form.tasks).filter(isAiTask), settings.employerMode, config.tasks[provider]);
  const next = withEngineTasks(config, provider, picked);
  await setAiEngineConfig(next);
  if (wantsJson) return c.json({ ok: true });
  return flashRedirect('/settings?tab=ai', 'ok', tasksSaved(AI_PROVIDER_LABELS[provider], next.tasks[provider], settings.employerMode));
});

/** TASKS S5 (Q29): start `npm start` at login, or stop — the one button is also the undo. */
settingsRoute.post('/settings/login-item', async (c) => {
  const form = await c.req.parseBody();
  const on = form.on === '1';
  const result = await setLoginItem(on);
  if (!result.ok) return flashRedirect('/settings?tab=general#login', 'err', `Login start not changed: ${result.reason}.`);
  return flashRedirect(
    '/settings?tab=general#login',
    'ok',
    on ? 'ApplyPack will start when you log in. The same button stops it.' : 'ApplyPack will no longer start at login.',
  );
});

/** ADR 0057: the local engine's Ollama address and its context window. */
settingsRoute.post('/settings/ai/local', async (c) => {
  const form = await c.req.parseBody();
  if (form.clear === '1') {
    await setLocalAiUrl(null);
    forgetAiProbe();
    return flashRedirect('/settings?tab=ai', 'ok', `Ollama address cleared — the engine uses ${config.OLLAMA_URL} again.`);
  }
  if (typeof form.contextTokens === 'string') {
    const tokens = Number(form.contextTokens);
    if (!(LOCAL_CONTEXT_CHOICES as readonly number[]).includes(tokens)) {
      return flashRedirect('/settings?tab=ai', 'err', 'That context window is not one of the choices; nothing changed.');
    }
    await setLocalContextTokens(tokens);
    return flashRedirect('/settings?tab=ai', 'ok', `Context window set to ${tokens.toLocaleString('en-US')} tokens.`);
  }
  const checked = checkLocalAiUrl(typeof form.baseUrl === 'string' ? form.baseUrl : '');
  if (!checked.ok) return flashRedirect('/settings?tab=ai', 'err', `Ollama address not saved: ${checked.reason}`);
  await setLocalAiUrl(checked.url);
  forgetAiProbe();
  return flashRedirect('/settings?tab=ai', 'ok', `Ollama address saved: ${checked.url}. Press Test to list its models.`);
});

/** TASKS S1: the OpenAI-compatible engine's server, set here instead of in .env. */
settingsRoute.post('/settings/ai/openai-base', async (c) => {
  const form = await c.req.parseBody();
  if (form.clear === '1') {
    await setOpenAiBaseUrl(null);
    forgetAiProbe();
    return flashRedirect('/settings?tab=ai', 'ok', `Server address cleared — the engine uses ${config.OPENAI_BASE_URL} again.`);
  }
  const checked = checkOpenAiBaseUrl(typeof form.baseUrl === 'string' ? form.baseUrl : '');
  if (!checked.ok) return flashRedirect('/settings?tab=ai', 'err', `Server address not saved: ${checked.reason}`);
  await setOpenAiBaseUrl(checked.url);
  forgetAiProbe();
  return flashRedirect(
    '/settings?tab=ai',
    'ok',
    `Server saved: ${checked.url}.${isLocalUrl(checked.url) ? ' A local server needs no key and costs nothing.' : ''} Press Test to list its models.`,
  );
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
    what: 'A job-ad aggregator in nineteen countries — Germany, France, Poland, the UK, the US, India and more — with ads from boards this app has no other way to see.',
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
    cost: 'the board\'s licence: every offer is shown whole with its source, date and licence link, and each stored offer is re-checked daily. That re-check runs on every hourly tick whatever else you switch off — pausing fetching does not pause it — so the obligation is not yours to remember. Offers the board withdraws are deleted here, or kept anonymised when they are your own application record; an offer this app could not re-check for two days goes the same way. Charging job seekers for a service built on this data is forbidden by French law.',
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
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', UNKNOWN_ENGINE);
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
  // The count and the write go together. Read the count, hand back to
  // the event loop, then write, and a settings tab editing the same list in
  // between decided from a stale one. A card dragged into the column in that
  // instant is still possible — the drag itself takes no lock, and making
  // every card move queue on one row would be a poor trade — so a stranded
  // job is caught by the "Unfiled" column on the board rather than lost.
  const outcome = await withGlobalWriteLock(async (tx) => {
    const held = await tx.job.count({ where: { pipelineStage: key } });
    if (held > 0) return { kind: 'in-use' as const, held };
    const row = await tx.appSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { pipelineStages: true },
    });
    const next = removeStage(parseStageConfig(row?.pipelineStages), key);
    if (typeof next === 'string') return { kind: 'refused' as const, error: next };
    await tx.appSettings.update({
      where: { id: SETTINGS_ID },
      data: { pipelineStages: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue },
    });
    return { kind: 'ok' as const };
  });
  if (outcome.kind === 'in-use') {
    return flashRedirect(
      STAGES_BACK,
      'err',
      `Move ${outcome.held} job${outcome.held === 1 ? '' : 's'} out of that column first.`,
    );
  }
  if (outcome.kind === 'refused') {
    return flashRedirect(STAGES_BACK, 'err', STAGE_ERROR_TEXT[outcome.error]);
  }
  return flashRedirect(STAGES_BACK, 'ok', 'Column removed.');
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

/** TASKS N9: turning the check on looks right away — one request — so the answer is on the page now, not on Sunday. */
settingsRoute.post('/settings/update-check-toggle', async (c) => {
  const enabling = !(await getSettings()).updateCheck;
  await setUpdateCheck(enabling);
  forgetUpdateNotice();
  if (!enabling) return flashRedirect('/settings?tab=general#updates', 'ok', 'No more update checks.');
  const latest = await checkForUpdate();
  return flashRedirect(
    '/settings?tab=general#updates',
    'ok',
    latest === null
      ? 'Checking weekly. GitHub did not answer just now; the next look is on Sunday.'
      : isNewer(APP_VERSION, latest)
        ? `Checking weekly. v${latest} is out — you run v${APP_VERSION}.`
        : `Checking weekly. You run the latest release, v${APP_VERSION}.`,
  );
});

/**
 * ADR 0061: the interface's language — from the menu, the wizard's first step,
 * Settings, or an answer to the one-time invitation (which stores English as
 * surely as it stores the other). The flash is worded in the language chosen.
 */
settingsRoute.post('/settings/locale', async (c) => {
  const form = await c.req.parseBody();
  const back = safeBack(form.back, LANGUAGE_SECTION);
  const locale = form.locale;
  if (!isSelectableLocale(locale)) return flashRedirect(back, 'err', t('language.unknown'));
  await setLocale(locale);
  return flashRedirect(back, 'ok', withLocale(locale, () => t('language.saved')));
});

/** ADR 0063: application packs — the whole form at once, as the schedule is saved. */
settingsRoute.post('/settings/pack', async (c) => {
  const pack = packSettingsFromForm(await c.req.parseBody({ all: true }));
  await setPackSettings(pack);
  return flashRedirect(
    '/settings?tab=general#packs',
    'ok',
    pack.enabled
      ? `Application packs on: a new posting with fit ${pack.minFit} or more, published in the last ${pack.maxAgeDays} days, gets one — ` +
          `${pack.dailyLimit === 0 ? 'with no daily limit' : `${pack.dailyLimit} a day at most`}. Jobs already stored are not touched.`
      : 'Application packs off: none is prepared on its own. A single job can still be prepared on its Application pack tab.',
  );
});

/** ADR 0056: the re-apply window — one of the listed choices, or off. */
settingsRoute.post('/settings/reapply', async (c) => {
  const body = await c.req.parseBody();
  const raw = typeof body.days === 'string' ? body.days.trim() : '';
  const days = raw === '' ? null : Number(raw);
  if (days !== null && !isReapplyChoice(days)) {
    return flashRedirect('/settings?tab=general', 'err', 'The re-apply window was not changed: pick one of the listed lengths, or Off.');
  }
  await setReapplyDays(days);
  return flashRedirect(
    '/settings?tab=general',
    'ok',
    days === null
      ? 'Re-apply window off: every company is read again.'
      : `Re-apply window: ${days} days. New postings at a company you applied to in that time are turned away before any AI.`,
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

settingsRoute.post('/settings/employer-mode-toggle', async (c) => {
  const settings = await getSettings();
  const next = !settings.employerMode;
  await setEmployerMode(next);
  setEmployerModeCache(next);
  return flashRedirect(
    '/settings?tab=screening',
    'ok',
    next ? 'Employer mode on — Screening is in the menu.' : 'Employer mode off — Screening is hidden; stored screenings keep their retention dates.',
  );
});

settingsRoute.post('/settings/screening-retention', async (c) => {
  const form = await c.req.parseBody();
  const days = Number(form.days);
  if (!Number.isFinite(days)) return flashRedirect('/settings?tab=screening', 'err', 'Enter a number of days.');
  await setScreeningRetentionDays(days);
  const saved = (await getSettings()).screeningRetentionDays;
  return flashRedirect('/settings?tab=screening', 'ok', `New screenings are kept for ${saved} days.`);
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
  // Rows the tick never fetches have no switch — keep them out of disabledSources.
  const allSources = Object.values(AtsType).filter(fetchedSource) as string[];
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

/** Both channels land here; `kind` says which form it was. A real test message goes out before the row is saved. */
settingsRoute.post('/settings/targets', onceGuard(() => 'targets:add', () => '/settings?tab=notifications'), async (c) => {
  const form = await c.req.parseBody();
  const back = '/settings?tab=notifications';
  if (form.kind === 'discord') {
    const parsed = DiscordTargetSchema.safeParse({ name: form.name, webhookUrl: form.webhookUrl });
    if (!parsed.success) {
      return flashRedirect(back, 'err', 'Invalid input — a name and a Discord webhook URL (https://discord.com/api/webhooks/…) are required.');
    }
    // Before the test message, so a repeat does not post twice to the channel.
    const same = await findSameDestination({ kind: 'DISCORD', ...parsed.data });
    if (same) return flashRedirect(back, 'err', `That webhook is already added as "${same.name}".`);
    const test = await testDiscordWebhook(parsed.data.webhookUrl);
    if (!test.ok) {
      return flashRedirect(back, 'err', `The test message did not reach Discord (${test.error ?? 'no reason given'}), so the webhook was not saved. Check the URL and add it again.`);
    }
    const added = await addNotificationTarget({ kind: 'DISCORD', ...parsed.data });
    if (!added) {
      return flashRedirect(back, 'err', 'That webhook was added from another tab a moment ago, so it was not added twice. The test message did reach the channel.');
    }
    return flashRedirect(back, 'ok', `Added Discord webhook "${parsed.data.name}". Test message sent.`);
  }
  const parsed = TelegramTargetSchema.safeParse({
    name: form.name,
    botToken: form.botToken,
    chatId: form.chatId,
  });
  if (!parsed.success) {
    return flashRedirect(back, 'err', 'Invalid input — name, token, chat id required.');
  }
  const same = await findSameDestination({ kind: 'TELEGRAM', ...parsed.data });
  if (same) return flashRedirect(back, 'err', `That bot and chat are already added as "${same.name}".`);
  const test = await testTelegramTarget(parsed.data.botToken, parsed.data.chatId);
  if (!test.ok) {
    return flashRedirect(back, 'err', `The test message did not reach Telegram (${test.error ?? 'no reason given'}), so the target was not saved. Check the token and the chat id, and add it again.`);
  }
  const added = await addNotificationTarget({ kind: 'TELEGRAM', ...parsed.data });
  if (!added) {
    return flashRedirect(back, 'err', 'That bot and chat were added from another tab a moment ago, so they were not added twice. The test message did arrive.');
  }
  return flashRedirect(
    back,
    'ok',
    `Added target "${parsed.data.name}" (bot @${test.botUsername ?? '?'}). Test message sent.`,
  );
});

settingsRoute.post('/settings/targets/:id/toggle', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await toggleNotificationTarget(id);
  return flashRedirect('/settings?tab=notifications', 'ok', 'Target toggled.');
});

settingsRoute.post('/settings/targets/:id/delete', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  await deleteNotificationTarget(id);
  return flashRedirect('/settings?tab=notifications', 'ok', 'Target deleted.');
});

settingsRoute.post('/settings/targets/:id/test', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const t = await prisma.notificationTarget.findUnique({ where: { id } });
  if (!t) return flashRedirect('/settings?tab=notifications', 'err', 'That target no longer exists, so no test was sent. The list below is current.');
  if (t.kind === 'DISCORD') {
    const result = await testDiscordWebhook(t.webhookUrl ?? '');
    return result.ok
      ? flashRedirect('/settings?tab=notifications', 'ok', `Test sent to "${t.name}".`)
      : flashRedirect('/settings?tab=notifications', 'err', testFailed(t.name, result.error));
  }
  const result = await testTelegramTarget(t.botToken ?? '', t.chatId ?? '');
  if (result.ok) {
    return flashRedirect(
      '/settings?tab=notifications',
      'ok',
      `Test sent to "${t.name}" (bot @${result.botUsername ?? '?'}).`,
    );
  }
  return flashRedirect('/settings?tab=notifications', 'err', testFailed(t.name, result.error));
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
  const id = idParam(form.id);
  const want = form.active === '1';
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', UNKNOWN_SEARCH);
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
      err instanceof Error ? err.message : 'The search did not change state, and nothing else changed. Try again.',
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
  const id = idParam(form.id);
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', UNKNOWN_SEARCH);
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
      err instanceof Error ? err.message : 'The primary search did not change, and nothing else changed. Try again.',
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
  const id = idParam(form.id);
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', UNKNOWN_SEARCH);
  try {
    await deleteProfile(id);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      err instanceof Error ? err.message : 'The search was not deleted, and nothing else changed. Try again.',
    );
  }
  return flashRedirect('/settings?tab=profile', 'ok', 'Search deleted.');
});

settingsRoute.post('/settings/profiles/:id/save', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const before = await getProfile(id);
  if (!before) {
    return flashRedirect('/settings?tab=profile', 'err', SEARCH_GONE);
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
    return flashRedirect('/settings?tab=profile', 'err', `${firstIssue(parsed.error.issues)}. Profile not saved; fix that field and save again.`, refusedField(c.req.path, parsed.error.issues));
  }
  const f = parsed.data;

  const notificationTargetId = optionalId(f.notificationTargetId);
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
    notificationTargetId === null
      ? null
      : prisma.notificationTarget.findUnique({ where: { id: notificationTargetId }, select: { id: true } }),
  ]);
  const missing = missingLinkMessage({
    resumeGone: resumeId !== null && resumeRow === null,
    notificationTargetGone: notificationTargetId !== null && targetRow === null,
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
    notificationTargetId,
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
    const started = triggerReclassifyAsync();
    return flashRedirect(
      editorUrl,
      'ok',
      `Search saved${activated ? ' and started' : ''}. ${
        started
          ? 'Re-classify started in the background'
          : 'A re-classify was already running, so this one joins it'
      } — track progress at /runs.${sourcesHint}`,
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
  return ` ${waiting} source${waiting === 1 ? '' : 's'} fit these countries — Companies → "Sources for your searches" → Enable all.`;
}

// Prefill the editor from a resume's AI scan. Renders the draft directly —
// nothing is saved until the user submits the profile form. With no resumes
// yet the card sends a file instead of a resumeId: the upload becomes a real
// Resume row (first one turns default in createResume), then the same flow.
settingsRoute.post(
  '/settings/profiles/:id/fill-from-resume',
  resumeUploadLimit('/settings?tab=profile'),
  onceGuard((c) => `fill:${c.req.param('id')}`, () => '/settings?tab=profile'),
  async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const profile = await getProfile(id);
  if (!profile) return flashRedirect('/settings?tab=profile', 'err', SEARCH_GONE);
  const form = await c.req.parseBody();
  let resume;
  if (form.file instanceof File && form.file.size > 0) {
    const upload = await readResumeUpload(form);
    if ('error' in upload) return flashRedirect('/settings?tab=profile', 'err', upload.error);
    resume = await createResume({ name: nameFromFilename(upload.sourceFilename), ...upload });
  } else {
    const resumeId = idParam(form.resumeId);
    if (!Number.isFinite(resumeId)) {
      return flashRedirect('/settings?tab=profile', 'err', 'Pick a resume first.');
    }
    resume = await getResume(resumeId);
  }
  if (!resume || resume.hidden) {
    return flashRedirect('/settings?tab=profile', 'err', 'That resume no longer exists, so no draft was made. Pick another under Fill from a resume.');
  }

  // Scans from before the primary-stack field (or failed ones) re-scan here.
  if (!resume.scannedAt || resume.primarySkills.length === 0) {
    const scan = await scanResume({ id: resume.id, text: resume.text });
    if (!scan) {
      return flashRedirect(
        '/settings?tab=profile',
        'err',
        `The AI scan of "${resume.name}" failed, so there is no draft and the profile is unchanged. Test the engine on the AI engine tab, then try again.`,
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

/** False when one is already running — the caller must not claim it started. */
function triggerReclassifyAsync(): boolean {
  if (reclassifyInFlight) return false;
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
  return true;
}
