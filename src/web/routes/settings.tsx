/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { choiceParam, idParam, switchParam } from '../params';
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
  getPackSettings,
  getSchedule,
  getSettings,
  listActiveNotificationTargets,
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
  setDashboardUrl,
  setUpdateCheck,
  setTelegramEnabled,
  testTelegramTarget,
  setNotificationTargetActive,
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
import { config, setInEnv } from '../../config';
import { ALL_DAYS, MAX_DIGEST_HOURS, ScheduleSchema, describeSchedule, parseSchedule } from '../../user-schedule';
import { canonicalZone, readZone, timeZoneChoices } from '../time-zones';
import { loadHeldLine, loadNextCheck } from '../schedule-view';
import { alertsSwitchedLine } from '../held-line';
import {
  addStage,
  allStages,
  MAX_STAGE_LABEL,
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
  unsetModelName,
  withEngineTasks,
  type AiEngineConfig,
  type AiEngineEnv,
  type AiProviderId,
} from '../../ai-engine';
import { AI_TASKS, isAiTask, taskLabel } from '../../ai-tasks';
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
import { checkDashboardUrl } from '../../notify/dashboard-link';
import { billingNotes } from '../../ai-spend';
import { engineTroubles } from '../../ai-health';
import { troubleLine } from '../usage-hints';
import { billedThisMonth, loadRecentAttempts, loadWindowRefusals } from '../../ai-ledger';
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
  typedSourceKeys,
  type KeyedSource,
  type SourceKeyField,
  type SourceKeys,
} from '../../source-keys';
import { groupSources, type SourceCount, fetchedSource } from '../source-groups';
import { profileLine } from '../profile-line';
import { testAiEngine } from '../ai-test';
import { startEngineTrial, trialViews, type TrialView } from '../engine-trial-run';
import { misfitLine, misfitSince, windowMisfits } from '../window-misfits';
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
import { countReclassifyAll, runReclassifyAll } from '../../jobs/reclassify-job';
import { spendHint } from '../cost-hint';
import { recordCronRun } from '../../jobs/cron-run';
import { parseTagList, toStringArray } from '../../text-utils';
import { isCountryCode, isRegionCode, resolveCountries } from '../../countries';
import { isRelocation, parseResidence } from '../../eligibility';
import { isProfileWorkplace } from '../../location';
import { suggestSources } from '../../starter-packs/suggest';
import {
  parsePriorityRulesText,
} from '../../priority-rules';
import { prisma } from '../../db';
import { isBlankProfile } from '../../profile-guards';
import { filterChanged } from '../../filter';
import { foldersReadAgainHint } from '../folder-words-io';
import type { Profile } from '@prisma/client';
import { isSettingsTab, SettingsPage, type EngineServer, type ProfileDraftNotice, type SettingsProps, type SettingsTab, type SourceKeyRow } from '../pages/settings';
import { blankSearchToReuse, lineListField, minFitField, minSalaryField, profileFieldLabel, reclassifyQuestion, sentProfile, seniorityField, tagListField } from '../profile-form';
import { packFieldLabel, scheduleFieldLabel, scheduleInput } from '../form-fields';
import { retentionParam } from '../retention-choices';
import { packSettingsFromForm, parsePackSettings, switchedOn } from '../../pack/settings';
import { cancelQueuedAutoPacks } from '../../pack/store';
import { sourceLabel } from '../source-names';
import { clearFlashCookie, firstIssue, flashRedirect, parseFlashCookie, refusedField, safeBack } from '../flash';
import type { MessageKey } from '../../i18n/catalog';
import { formatList, formatNumber } from '../../i18n/format';
import { isSelectableLocale, withLocale } from '../../i18n/locale';
import { t } from '../../i18n/t';
import { describeDestination } from '../../notify/targets';
import { isDiscordWebhookUrl, testDiscordWebhook } from '../../notify/discord';
import { savedChatRefusal } from '../../notify/telegram-check';
import { missingLinkMessage } from '../profile-links';
import { getResume, listResumes, upsertScratchResume, type ResumeSummary } from '../../resume/store';
import { scanResume } from '../../resume/scan';
import { buildProfileDraft } from '../../resume/profile-draft';
import { nameFromFilename, readResumeUpload, resumeUploadLimit } from '../upload';

/*
 * A flash that refuses says what it refused, what is safe and what to do next.
 * The first two answer a request the page's own forms cannot send, the third a
 * page gone stale — so the way forward is the page as it is now. Kept as keys:
 * the words are read when the flash is made, in the language of that request.
 */
const UNKNOWN_ENGINE = 'settingsRoute.unknownEngine' satisfies MessageKey;
const UNKNOWN_SEARCH = 'settingsRoute.unknownSearch' satisfies MessageKey;
const SEARCH_GONE = 'settingsRoute.searchGone' satisfies MessageKey;

/** What stands where a channel's own reason would, when it gave none. */
const noReason = (): string => t('settingsRoute.noReasonGiven');

const testFailed = (name: string, reason: string | undefined): string =>
  t('settingsRoute.targets.testFailed', { name, reason: reason ?? noReason() });

/** Whole sentences side by side; the ones that do not apply are empty. */
const sentences = (...parts: string[]): string => parts.filter((part) => part !== '').join(' ');

/** Dollars and cents as `toFixed(2)` writes them, with the reader's decimal mark. */
const USD_AMOUNT = { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false } as const;

const TelegramTargetSchema = z.object({
  name: z.string().min(1).max(100),
  botToken: z.string().min(20).max(200),
  chatId: z.string().min(1).max(100),
});

const TELEGRAM_FIELD_LABEL: Record<string, MessageKey> = { name: 'settings.name', botToken: 'settings.botToken', chatId: 'settings.chatId' };

function telegramFieldLabel(field: string): string | undefined {
  const key = TELEGRAM_FIELD_LABEL[field];
  return key ? t(key) : undefined;
}

const DiscordTargetSchema = z.object({
  name: z.string().min(1).max(100),
  webhookUrl: z.string().min(20).max(400).refine(isDiscordWebhookUrl, 'not a Discord webhook URL'),
});

const ProfileFormSchema = z.object({
  name: z.string().min(1).max(100),
  stackRequired: tagListField,
  roleTypes: tagListField,
  stackNiceToHave: tagListField,
  stackExclude: tagListField,
  notes: z.string().max(4_000).optional().default(''),
  seniority: seniorityField,
  // ADR 0032: chips post one value each, the no-JS textarea posts a list.
  countries: z.union([z.string(), z.array(z.string())]).optional(),
  regions: z.union([z.string(), z.array(z.string())]).optional(),
  workplace: z.union([z.string(), z.array(z.string())]).optional(),
  // ADR 0033: where the candidate lives, and whether they would move.
  residence: z.string().optional().default(''),
  relocation: z.string().optional().default('no'),
  onsiteCities: lineListField,
  minSalaryUsd: minSalaryField,
  minFitScore: minFitField,
  notificationTargetId: z.string().optional().default(''),
  resumeId: z.string().optional().default(''),
  priorityRules: z.string().optional().default(''),
  action: z.string().optional(),
});

// UI copy per backend, as catalog keys; availability comes from probeAiProviders().
const AI_PROVIDER_DESCS = {
  anthropic_api: 'settingsRoute.engineDesc.anthropic_api',
  claude_code: 'settingsRoute.engineDesc.claude_code',
  gemini_cli: 'settingsRoute.engineDesc.gemini_cli',
  agy_cli: 'settingsRoute.engineDesc.agy_cli',
  openai_api: 'settingsRoute.engineDesc.openai_api',
  codex_cli: 'settingsRoute.engineDesc.codex_cli',
  local_api: 'settingsRoute.engineDesc.local_api',
} as const satisfies Record<AiProviderId, MessageKey>;

let reclassifyInFlight = false;

/** Where the language is chosen on Settings: the switcher's way back when a form names none. */
const LANGUAGE_SECTION = '/settings?tab=general#language';

export const settingsRoute = new Hono();

/** Everything the settings page needs except activeTab/flash/profileDraft —
 *  shared by the GET and by POSTs that render a draft instead of redirecting. */

/** Engine cards: the list in priority order, then the last resort (it serves), then the rest. */
function cardRank(e: { enabled: boolean; position: number; lastResort: boolean }): number {
  if (e.enabled) return e.position;
  return e.lastResort ? AI_PROVIDER_IDS.length : AI_PROVIDER_IDS.length + 1;
}

/** `here` is the address this page was asked at: the example the dashboard address field offers. */
async function loadSettingsProps(here: string, tab: SettingsTab) {
  // The keys are read once and lent to the probe — both need them (ADR 0027).
  const aiKeys = await getAiKeys();
  // The engine cards are the AI tab's alone: no other tab waits on the probe or reads the ledger for them (#649).
  const aiTab = tab === 'ai';
  const [settings, targets, profiles, active, resumes, aiStatuses, stageCounts, billedMonth, recentAttempts] =
    await Promise.all([
      getSettings(),
      listNotificationTargets(),
      listProfiles(),
      getActiveProfile(),
      listResumes(),
      aiTab ? probeAiProviders(aiKeys, { fresh: true }) : null,
      prisma.job.groupBy({
        by: ['pipelineStage'],
        _count: { _all: true },
        where: { pipelineStage: { not: null } },
      }),
      billedThisMonth(),
      aiTab ? loadRecentAttempts() : [],
    ]);
  // "available" is what the probe found on disk; whether calls get through is what the ledger's last rows say (#413).
  const troubles = new Map(engineTroubles(recentAttempts).map((trouble) => [trouble.engine, troubleLine(trouble)]));
  const check = await loadNextCheck(settings.schedule);
  const scheduleView = {
    schedule: check.schedule,
    zone: canonicalZone(check.schedule.timezone) ?? check.schedule.timezone,
    zones: timeZoneChoices(),
    nextFetch: check.next,
    held: await loadHeldLine(check.schedule),
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
      label: t('settingsRoute.server.openai.label'),
      hint: t('settingsRoute.server.openai.hint'),
      more: t('settingsRoute.server.openai.more'),
      value: openAiServer,
      stored: openAiBaseUrl !== null,
      fromEnv: setInEnv('OPENAI_BASE_URL'),
      local: isLocalUrl(openAiServer),
    },
    local_api: {
      action: '/settings/ai/local',
      envVar: 'OLLAMA_URL',
      label: t('settingsRoute.server.local.label'),
      hint: t('settingsRoute.server.local.hint'),
      value: localServer,
      stored: settings.localAiUrl !== null,
      fromEnv: setInEnv('OLLAMA_URL'),
      local: true,
      context: { value: settings.localContextTokens ?? DEFAULT_LOCAL_CONTEXT_TOKENS, choices: LOCAL_CONTEXT_CHOICES },
    },
  };
  const billing = billingFacts(aiKeys, openAiBaseUrl);
  const billingFor = (id: AiProviderId): AiBilling => billingOf(id, billing);
  const aiEnv = getAiEngineEnv(aiKeys, openAiBaseUrl);
  const engine = resolveAiEngine(settings.aiEngine, aiEnv);
  const aiConfig = parseAiEngineConfig(settings.aiEngine);
  const aiEngines = aiStatuses === null ? [] : AI_PROVIDER_IDS.map((id) => {
    // A CLI engine with no model set runs whatever its own configuration names; the local engine runs none (#563).
    const unset = unsetModelName(id) ?? '';
    const classifierDefault = defaultModelFor(id, 'classifier', aiEnv) || unset;
    const resumeDefault = defaultModelFor(id, 'resume', aiEnv) || unset;
    const storedKey = providerTakesKey(id) ? aiKeys[id] : undefined;
    return {
      id,
      label: AI_PROVIDER_LABELS[id],
      desc: t(AI_PROVIDER_DESCS[id]),
      ok: aiStatuses[id].ok,
      detail: aiStatuses[id].detail,
      trouble: troubles.get(id) ?? null,
      ...aiEngineCard(aiConfig, id, aiEnv),
      tasks: AI_TASKS.filter((task) => taskShown(task, settings.employerMode)).map((task) => ({
        id: task,
        label: taskLabel(task),
        taken: engine.takes(id, task),
        offered: offeredTasks(id).includes(task),
      })),
      classifierModel: aiConfig.models[id]?.classifier ?? '',
      resumeModel: aiConfig.models[id]?.resume ?? '',
      coverModel: aiConfig.models[id]?.cover ?? '',
      classifierDefault,
      resumeDefault,
      // An empty cover slot takes the engine's own letter default, not the resume slot.
      coverDefault: defaultModelFor(id, 'cover', aiEnv) || unset,
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
  // A trial sits under an engine's tasks, which only an engine in the list shows.
  const trials = aiTab
    ? await trialViews(
        aiEngines.filter((e) => e.enabled).map((e) => e.id),
        (id) => engine.modelFor(id, 'classifier'),
        billingFor,
      )
    : new Map<AiProviderId, TrialView>();
  // #411: a ticked task whose prompt the engine refused as too large for its window lately.
  const windowLog = aiTab ? await loadWindowRefusals(misfitSince(new Date())) : { refusals: [], fallbacks: [] };
  const localWindow = settings.localContextTokens ?? DEFAULT_LOCAL_CONTEXT_TOKENS;
  const misfitsOf = (e: (typeof aiEngines)[number]): string[] =>
    windowMisfits(e.id, windowLog.refusals, windowLog.fallbacks)
      .filter((m) => e.tasks.some((task) => task.id === m.task && task.taken))
      .map((m) => misfitLine(m, e.id === 'local_api' ? localWindow : null));
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
  // "Save & re-classify" is on the Job search tab alone: the jobs are counted and the cost read for it only (#607).
  let reclassifyAsk = '';
  if (tab === 'profile') {
    const [jobs, cost] = await Promise.all([countReclassifyAll(), spendHint('classifier')]);
    reclassifyAsk = reclassifyQuestion(jobs, cost);
  }
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
    dashboard: { url: settings.dashboardUrl, here },
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
    aiEngines: aiEngines.map((e) => ({ ...e, trial: trials.get(e.id) ?? null, misfits: e.enabled ? misfitsOf(e) : [] })),
    aiStatus,
    aiBudget,
    targets: targets.map((target) => ({
      id: target.id,
      name: target.name,
      kind: target.kind,
      destination: describeDestination(target),
      active: target.active,
      createdAt: target.createdAt,
      lastUsed: target.lastUsed,
    })),
    profiles: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      running: p.active,
      primary: active?.id === p.id,
      blank: isBlankProfile(p),
      line: profileLine(p),
    })),
    activeProfile: active,
    reclassifyQuestion: reclassifyAsk,
    availableTargets: targets.map((target) => ({
      id: target.id,
      name: target.name,
      kind: target.kind,
      active: target.active,
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
      retentionDefault: SCREENING_RETENTION_DAYS.default,
      engineLabel: AI_PROVIDER_LABELS[screeningEngine],
      engineSubscription: billingFor(screeningEngine) === 'plan',
      screenings: screeningCount,
      notice: applicantNotice(undefined, settings.screeningRetentionDays),
      legalNote: LEGAL_NOTE,
    },
  };
}

settingsRoute.get('/settings', async (c) => {
  const tabParam = c.req.query('tab');
  const activeTab = isSettingsTab(tabParam) ? tabParam : 'profile';
  const props = await loadSettingsProps(new URL(c.req.url).origin, activeTab);
  // ?profile= points the editor at a specific (possibly inactive) profile.
  // "+ New profile" lands here: new profiles are born inactive (issue #50)
  // and must be editable before activation.
  const profileParam = idParam(c.req.query('profile'));
  if (Number.isFinite(profileParam)) {
    const editorProfile = await getProfile(profileParam);
    if (editorProfile) props.activeProfile = editorProfile;
  }
  const fill = idParam(c.req.query('fill'));
  const keys = c.req.query('keys');
  // `?draft=` is where "Fill from a resume" lands (#555): the draft read again off the resume's stored scan, no AI on a view.
  const draftFrom = idParam(c.req.query('draft'));
  const scanned = Number.isFinite(draftFrom) ? await getResume(draftFrom) : null;
  const draft = scanned?.scannedAt && props.activeProfile ? fillDraft(props.activeProfile, scanned) : null;
  const flash = parseFlashCookie(c.req.header('cookie'));
  return c.html(
    <SettingsPage
      {...props}
      {...(draft && !draft.empty ? { activeProfile: draft.activeProfile, profileDraft: draft.notice } : {})}
      fillResumeId={Number.isFinite(fill) ? fill : undefined}
      openSourceKeys={isKeyedSource(keys) ? keys : undefined}
      activeTab={activeTab}
      flash={flash}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

/**
 * A refused form, sent back with what was typed in it (#549): the page again
 * from this POST, its flash on it and the field it is about marked, instead
 * of a redirect that would render the stored values over the typing.
 */
async function settingsAgain(
  c: Context,
  page: Partial<SettingsProps> & Pick<SettingsProps, 'activeTab'>,
  text: string,
  field?: string,
): Promise<Response> {
  const props = await loadSettingsProps(new URL(c.req.url).origin, page.activeTab);
  const flash = { kind: 'err' as const, text, ...(field ? { field: { form: c.req.path, name: field } } : {}) };
  return c.html(<SettingsPage {...props} {...page} flash={flash} />, 422);
}

// --- Fetching pause / resume -----------------------------------------------

settingsRoute.post('/settings/fetching-toggle', async (c) => {
  // The Overview quick control posts back="/" to land where it came from.
  const form = await c.req.parseBody();
  const back = form.back === '/' ? '/' : '/settings?tab=profile';
  const enabling = switchParam(form.on);
  if (enabling === null) return flashRedirect(back, 'err', t('http.noSwitchState'));
  await setFetchingEnabled(enabling);
  if (!enabling) {
    return flashRedirect(back, 'warn', t('settingsRoute.fetching.paused'));
  }
  const profile = await getActiveProfile();
  const gateEmpty =
    !profile || (profile.stackRequired.length === 0 && profile.roleTypes.length === 0);
  if (gateEmpty) {
    return flashRedirect(back, 'warn', t('settingsRoute.fetching.resumedNoGate'));
  }
  return flashRedirect(back, 'ok', t('settingsRoute.fetching.resumed'));
});


/**
 * Saves the schedule (TASKS §16), one part per form: when to search (Job
 * search tab), when alerts arrive (Notifications), the zone (General). Day and digest pills are
 * repeated checkboxes, so the body is read with `{ all: true }` (gotcha 1);
 * an empty day set would silence the search forever, so it falls back to
 * every day rather than saving nothing.
 */
settingsRoute.post('/settings/schedule', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const current = parseSchedule((await getSettings()).schedule, config.TZ);
  // Three forms on three tabs save one part each and keep the stored rest; a body with no part saves all of it.
  const part = schedulePart(form.part);
  const takes = (p: SchedulePart): boolean => part === null || part === p;
  const candidate = {
    // Only the zone's own form moves it: saving the hours never changes how every date reads (#538).
    timezone: takes('zone') ? readZone(str(form.timezone)) || current.timezone : current.timezone,
    fetch: takes('fetch')
      ? {
          every: str(form.fetchEvery),
          from: hour(form.fetchFrom, current.fetch.from),
          to: hour(form.fetchTo, current.fetch.to),
          days: pills(form.fetchDays, ALL_DAYS),
        }
      : current.fetch,
    alerts: takes('alerts')
      ? {
          mode: str(form.alertMode),
          from: hour(form.alertFrom, current.alerts.from),
          to: hour(form.alertTo, current.alerts.to),
          days: pills(form.alertDays, ALL_DAYS),
          digestAt: pills(form.digestAt, current.alerts.digestAt).slice(0, MAX_DIGEST_HOURS),
        }
      : current.alerts,
  };
  // The browser's zone, offered beside the hours, lands back where it was pressed.
  const back = SCHEDULE_BACK[schedulePart(form.from) ?? part ?? 'fetch'];
  const parsed = ScheduleSchema.safeParse(candidate);
  if (!parsed.success) {
    const { issues } = parsed.error;
    return flashRedirect(back, 'err', t('settingsRoute.schedule.notSaved', { issue: firstIssue(issues, scheduleFieldLabel) }), refusedField(c.req.path, issues, scheduleInput));
  }
  await setSchedule(parsed.data);
  if (part === 'zone') {
    const moved = canonicalZone(parsed.data.timezone) !== canonicalZone(current.timezone);
    return flashRedirect(back, 'ok', t(moved ? 'settingsRoute.schedule.zoneChanged' : 'settingsRoute.schedule.zoneSaved', { zone: parsed.data.timezone }));
  }
  const held = await loadHeldLine(parsed.data);
  const saved = part === 'alerts' ? t('settingsRoute.schedule.alertsSaved') : t('settingsRoute.schedule.saved', { schedule: describeSchedule(parsed.data) });
  return flashRedirect(back, 'ok', sentences(saved, held === null ? '' : `${held.text}.`));
});

/** Where each part of the schedule is set: the search's hours, the alerts' timing, the zone every date is written in. */
const SCHEDULE_BACK = {
  fetch: '/settings?tab=profile#schedule',
  alerts: '/settings?tab=notifications#alerts',
  zone: '/settings?tab=general#timezone',
} as const;

type SchedulePart = keyof typeof SCHEDULE_BACK;

function schedulePart(value: unknown): SchedulePart | null {
  const s = str(value);
  return Object.hasOwn(SCHEDULE_BACK, s) ? (s as SchedulePart) : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** One hour select; anything unreadable keeps what was stored. */
function hour(value: unknown, fallback: number): number {
  // An absent select is not midnight (#683): Number('') is 0.
  if (str(value) === '') return fallback;
  const n = Number(str(value));
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

/** Repeated checkboxes → numbers. An empty set means the user unticked them all, which is never what they meant. */
function pills(value: unknown, fallback: readonly number[]): number[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  // An empty time picker ("—") sends "", which Number() would read as 00:00.
  const picked = raw.filter((v) => str(v) !== '').map((v) => Number(str(v))).filter((n) => Number.isInteger(n));
  return picked.length > 0 ? picked : [...fallback];
}

// --- Telegram toggle / targets ---------------------------------------------

settingsRoute.post('/settings/telegram-toggle', async (c) => {
  const enabled = switchParam((await c.req.parseBody()).on);
  if (enabled === null) return flashRedirect('/settings?tab=notifications', 'err', t('http.noSwitchState'));
  await setTelegramEnabled(enabled);
  // Every channel, Discord included (ADR 0041) — the column is just old.
  const targets = (await listActiveNotificationTargets()).length;
  const held = enabled ? await loadHeldLine(await getSchedule()) : null;
  return flashRedirect('/settings?tab=notifications', 'ok', alertsSwitchedLine(enabled, targets, held));
});

/**
 * The list the engine cards show (`aiEngineOrder`), the stored config, and the
 * engine facts of this host: the .env engine that seeds the list, and the keys
 * and sign-ins that decide which engines can run.
 */
async function readAiOrder(): Promise<{
  order: AiProviderId[];
  config: AiEngineConfig;
  env: AiEngineEnv;
}> {
  const [settings, keys] = await Promise.all([getSettings(), getAiKeys()]);
  const config = parseAiEngineConfig(settings.aiEngine);
  const env = getAiEngineEnv(keys, settings.openAiBaseUrl);
  return { order: aiEngineOrder(config, env.provider), config, env };
}

settingsRoute.post('/settings/ai/enable', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', t(UNKNOWN_ENGINE));
  // The state the button asks for (#683): a second press, a resubmit or an old tab never undoes the first.
  const want = switchParam(form.on);
  if (want === null) return flashRedirect('/settings?tab=ai', 'err', t('http.noSwitchState'));
  const { order, config, env } = await readAiOrder();
  const engine = AI_PROVIDER_LABELS[provider];
  if (want === order.includes(provider)) {
    return flashRedirect('/settings?tab=ai', 'ok', t(want ? 'settingsRoute.ai.alreadyOn' : 'settingsRoute.ai.alreadyOff', { engine }));
  }
  const next = toggleAiEngine(config, provider, env);
  if (next === null) {
    return flashRedirect('/settings?tab=ai', 'warn', t('settingsRoute.ai.onlyEngine', { engine }));
  }
  await setAiEngineConfig({ ...config, order: next });
  if (order.includes(provider)) {
    // #647: the flash names the engine that answers now, which is not always the .env one.
    const { lastResort } = resolveAiEngine({ ...config, order: next }, env);
    if (lastResort !== null) {
      return flashRedirect('/settings?tab=ai', 'warn', t('settingsRoute.ai.disabledLastResort', { engine, fallback: AI_PROVIDER_LABELS[lastResort] }));
    }
    if (next.length === 0) {
      return flashRedirect('/settings?tab=ai', 'warn', t('settingsRoute.ai.disabledFallback', { engine, fallback: AI_PROVIDER_LABELS[env.provider] }));
    }
    return flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.ai.disabled', { engine }));
  }
  const placed = { engine, n: next.length };
  const statuses = await probeAiProviders(undefined, { fresh: true });
  if (!statuses[provider].ok) {
    return flashRedirect('/settings?tab=ai', 'warn', t('settingsRoute.ai.enabledUnusable', { ...placed, detail: statuses[provider].detail }));
  }
  // A metered engine standing behind subscription engines = money spent
  // exactly when the free capacity runs out — say so up front.
  const [keys, { openAiBaseUrl }] = await Promise.all([getAiKeys(), getSettings()]);
  const billing = billingFacts(keys, openAiBaseUrl);
  if (billingOf(provider, billing) === 'billed' && next.slice(0, -1).some((id) => billingOf(id, billing) !== 'billed')) {
    return flashRedirect('/settings?tab=ai', 'warn', t('settingsRoute.ai.enabledBilled', placed));
  }
  return flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.ai.enabled', placed));
});

/** The monthly ceiling on billed AI money (ADR 0055): dollars in, cents stored; empty or 0 = none. */
const MAX_AI_BUDGET_USD = 100_000;

settingsRoute.post('/settings/ai/budget', async (c) => {
  const form = await c.req.parseBody();
  const raw = typeof form.budget === 'string' ? form.budget.trim() : '';
  const usd = raw === '' ? 0 : Number(raw);
  if (!Number.isFinite(usd) || usd < 0 || usd > MAX_AI_BUDGET_USD) {
    return flashRedirect('/settings?tab=ai#budget', 'err', t('settingsRoute.budget.invalid', { max: MAX_AI_BUDGET_USD }));
  }
  const cents = Math.round(usd * 100);
  await setAiBudgetCents(cents > 0 ? cents : null);
  return flashRedirect(
    '/settings?tab=ai#budget',
    'ok',
    cents > 0 ? t('settingsRoute.budget.set', { amount: formatNumber(cents / 100, USD_AMOUNT) }) : t('settingsRoute.budget.removed'),
  );
});

settingsRoute.post('/settings/ai/move', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', t(UNKNOWN_ENGINE));
  const { order, config } = await readAiOrder();
  const idx = order.indexOf(provider);
  if (idx < 0) return flashRedirect('/settings?tab=ai', 'err', t('settingsRoute.ai.notInChain', { engine: AI_PROVIDER_LABELS[provider] }));
  if (idx === 0) return flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.ai.alreadyTop'));
  const next = [...order];
  [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
  await setAiEngineConfig({ ...config, order: next });
  return flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.ai.moved', { engine: AI_PROVIDER_LABELS[provider], n: idx }));
});

settingsRoute.post('/settings/ai/models', async (c) => {
  const form = await c.req.parseBody();
  // The cards save on change over fetch and want JSON back; the no-JS form
  // post wants the usual redirect + flash.
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
  const fail = (message: string) =>
    wantsJson ? c.json({ error: message }, 400) : flashRedirect('/settings?tab=ai', 'err', message);
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return fail(t('settingsRoute.ai.unknownEngineShort'));
  const engine = AI_PROVIDER_LABELS[provider];
  const classifier = cleanModelId(form.classifier);
  const resume = cleanModelId(form.resume);
  const cover = cleanModelId(form.cover);
  for (const model of [classifier, resume, cover]) {
    // Cut short it would name another model, saved as if it were this one (#683).
    if (model && model.length > MAX_MODEL_ID_CHARS) return fail(t('settingsRoute.ai.modelTooLong', { n: MAX_MODEL_ID_CHARS }));
    if (model && !modelFitsProvider(model, provider)) {
      return fail(t('settingsRoute.ai.notModelId', { model, engine }));
    }
  }
  const { config } = await readAiOrder();
  await setAiEngineConfig({
    ...config,
    models: { ...config.models, [provider]: { classifier, resume, cover } },
  });
  return wantsJson
    ? c.json({ ok: true })
    : flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.ai.modelsSaved', { engine }));
});

/** ADR 0060: the tasks an engine takes. Every box ticked is stored as no list, so the engine takes what a later version adds. */
settingsRoute.post('/settings/ai/tasks', async (c) => {
  // The boxes share one name (gotcha 1).
  const form = await c.req.parseBody({ all: true });
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) {
    return wantsJson ? c.json({ error: t(UNKNOWN_ENGINE) }, 400) : flashRedirect('/settings?tab=ai', 'err', t(UNKNOWN_ENGINE));
  }
  const settings = await getSettings();
  const config = parseAiEngineConfig(settings.aiEngine);
  const picked = pickedTasks(toStringArray(form.tasks).filter(isAiTask), settings.employerMode);
  const next = withEngineTasks(config, provider, picked);
  await setAiEngineConfig(next);
  if (wantsJson) return c.json({ ok: true });
  return flashRedirect('/settings?tab=ai', 'ok', tasksSaved(AI_PROVIDER_LABELS[provider], next.tasks[provider], settings.employerMode));
});

/** TASKS S5 (Q29): start `npm start` at login, or stop — the one button is also the undo. */
settingsRoute.post('/settings/login-item', async (c) => {
  const on = switchParam((await c.req.parseBody()).on);
  if (on === null) return flashRedirect('/settings?tab=general#login', 'err', t('http.noSwitchState'));
  const result = await setLoginItem(on);
  if (!result.ok) return flashRedirect('/settings?tab=general#login', 'err', t('settingsRoute.login.notChanged', { reason: result.reason }));
  return flashRedirect('/settings?tab=general#login', 'ok', t(on ? 'settingsRoute.login.on' : 'settingsRoute.login.off'));
});

/** ADR 0057: the local engine's Ollama address and its context window. */
settingsRoute.post('/settings/ai/local', async (c) => {
  const form = await c.req.parseBody();
  if (form.clear === '1') {
    await setLocalAiUrl(null);
    forgetAiProbe();
    return flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.local.cleared', { url: config.OLLAMA_URL }));
  }
  if (typeof form.contextTokens === 'string') {
    const tokens = Number(form.contextTokens);
    if (!(LOCAL_CONTEXT_CHOICES as readonly number[]).includes(tokens)) {
      return flashRedirect('/settings?tab=ai', 'err', t('settingsRoute.local.badContext'));
    }
    await setLocalContextTokens(tokens);
    return flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.local.contextSet', { tokens }));
  }
  const checked = checkLocalAiUrl(typeof form.baseUrl === 'string' ? form.baseUrl : '');
  if (!checked.ok) return flashRedirect('/settings?tab=ai', 'err', t('settingsRoute.local.notSaved', { reason: checked.reason }));
  await setLocalAiUrl(checked.url);
  forgetAiProbe();
  return flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.local.saved', { url: checked.url }));
});

/** TASKS S1: the OpenAI-compatible engine's server, set here instead of in .env. */
settingsRoute.post('/settings/ai/openai-base', async (c) => {
  const form = await c.req.parseBody();
  if (form.clear === '1') {
    await setOpenAiBaseUrl(null);
    forgetAiProbe();
    return flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.openai.cleared', { url: config.OPENAI_BASE_URL }));
  }
  const checked = checkOpenAiBaseUrl(typeof form.baseUrl === 'string' ? form.baseUrl : '');
  if (!checked.ok) return flashRedirect('/settings?tab=ai', 'err', t('settingsRoute.openai.notSaved', { reason: checked.reason }));
  await setOpenAiBaseUrl(checked.url);
  forgetAiProbe();
  return flashRedirect('/settings?tab=ai', 'ok', t(isLocalUrl(checked.url) ? 'settingsRoute.openai.savedLocal' : 'settingsRoute.openai.saved', { url: checked.url }));
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
    return flashRedirect('/settings?tab=ai', 'err', t('settingsRoute.key.notTaken'));
  }
  const engine = AI_PROVIDER_LABELS[provider];
  const clearing = form.clear === '1';
  const key = typeof form.key === 'string' ? form.key.trim() : '';
  if (!clearing && key.length === 0) {
    return flashRedirect('/settings?tab=ai', 'err', t('settingsRoute.key.pasteFirst', { engine }));
  }
  if (key.length > MAX_AI_KEY_LENGTH) {
    return flashRedirect('/settings?tab=ai', 'err', t('settingsRoute.key.tooLong', { n: key.length }));
  }
  await setAiKey(provider, clearing ? '' : key);
  forgetAiProbe();
  if (clearing) {
    const removed =
      aiKeySource(provider, {}) === 'env'
        ? t('settingsRoute.key.removedFallback', { engine, envVar: AI_KEY_ENV_VARS[provider] })
        : t('settingsRoute.key.removed', { engine });
    return flashRedirect('/settings?tab=ai', 'ok', removed);
  }
  return flashRedirect('/settings?tab=ai', 'ok', t('settingsRoute.key.saved', { engine }));
});

/** The keyed sources as the Sources tab shows them — origins and masks, never values (ADR 0034). */
function sourceKeyRows(keys: SourceKeys): SourceKeyRow[] {
  return KEYED_SOURCES.map((source) => {
    const meta = SOURCE_KEY_META[source];
    return {
      source,
      label: meta.label,
      what: t(meta.what),
      worthIt: t(meta.worthIt),
      cost: t(meta.cost),
      signupUrl: meta.signupUrl,
      signupLabel: t(meta.signupLabel),
      terms: t(meta.terms),
      termsUrl: meta.termsUrl,
      ready: sourceUnlocked(source, keys),
      fields: (Object.keys(SOURCE_KEY_FIELDS[source]) as SourceKeyField[]).map((field) => {
        const origin = sourceKeyOrigin(source, field, keys);
        const stored = keys[source]?.[field];
        return {
          field,
          label: fieldLabel(source, field),
          envVar: envVarOf(source, field),
          origin,
          masked: origin === 'db' && stored ? maskToken(stored) : '',
        };
      }),
    };
  });
}

/**
 * UI copy per keyed source, as catalog keys. The source and each of its fields
 * keep the vendor's own name, so they read here as they do on the vendor's page.
 */
const SOURCE_KEY_META: Record<
  KeyedSource,
  { label: string; what: MessageKey; worthIt: MessageKey; cost: MessageKey; signupUrl: string; signupLabel: MessageKey; terms: MessageKey; termsUrl: string; fields: Record<string, MessageKey> }
> = {
  ADZUNA: {
    label: 'Adzuna',
    what: 'settingsRoute.source.adzuna.what',
    worthIt: 'settingsRoute.source.adzuna.worthIt',
    cost: 'settingsRoute.source.adzuna.cost',
    signupUrl: 'https://developer.adzuna.com/signup',
    signupLabel: 'settingsRoute.source.adzuna.signup',
    terms: 'settingsRoute.source.adzuna.terms',
    termsUrl: 'https://developer.adzuna.com/docs/terms_of_service',
    fields: { app_id: 'settingsRoute.sourceKey.field.appId', app_key: 'settingsRoute.sourceKey.field.appKey' },
  },
  FRANCETRAVAIL: {
    label: 'France Travail',
    what: 'settingsRoute.source.francetravail.what',
    worthIt: 'settingsRoute.source.francetravail.worthIt',
    cost: 'settingsRoute.source.francetravail.cost',
    signupUrl: 'https://francetravail.io/produits-partages/catalogue',
    signupLabel: 'settingsRoute.source.francetravail.signup',
    terms: 'settingsRoute.source.francetravail.terms',
    termsUrl: 'https://francetravail.io/produits-partages/documentation/conditions-dutilisation-api/licence-offres-emploi',
    fields: { client_id: 'settingsRoute.sourceKey.field.clientId', client_secret: 'settingsRoute.sourceKey.field.clientSecret' },
  },
};

/** A keyed source's field in words: "Application ID"; a field the table does not name keeps its own name. */
function fieldLabel(source: KeyedSource, field: string): string {
  const key = SOURCE_KEY_META[source].fields[field];
  return key ? t(key) : field;
}

/**
 * Saves a keyed source's credential — every field it takes, with one Save —
 * or removes one field (ADR 0034). A field left empty keeps what is stored
 * (#561). As with engine keys, the value never comes back to the browser, a
 * log line or a flash message.
 */
settingsRoute.post('/settings/sources/key', async (c) => {
  const form = await c.req.parseBody();
  const source = typeof form.source === 'string' ? form.source : '';
  if (!isKeyedSource(source)) return flashRedirect('/settings?tab=sources', 'err', t('settingsRoute.sourceKey.unknown'));
  // Back to the card, open, so what the save changed can be read on it.
  const back = `/settings?tab=sources&keys=${source}#source-keys`;
  const labelOf = (fields: readonly string[]): string =>
    t('settingsRoute.sourceKey.label', { source: SOURCE_KEY_META[source].label, field: formatList(fields.map((field) => fieldLabel(source, field))) });
  if (form.clear === '1') {
    const field = form.field;
    if (!isSourceKeyField(source, field)) return flashRedirect(back, 'err', t('settingsRoute.sourceKey.unknown'));
    await setSourceKey(source, field, '');
    return flashRedirect(back, 'ok', t('settingsRoute.sourceKey.removed', { label: labelOf([field]) }));
  }
  const typed = typedSourceKeys(source, form);
  if (typed.length === 0) {
    return flashRedirect(back, 'err', t('settingsRoute.sourceKey.pasteFirst', { label: labelOf(Object.keys(SOURCE_KEY_FIELDS[source])) }));
  }
  const tooLong = typed.find((key) => key.value.length > MAX_SOURCE_KEY_LENGTH);
  if (tooLong) return flashRedirect(back, 'err', t('settingsRoute.sourceKey.tooLong', { n: tooLong.value.length }));
  for (const { field, value } of typed) await setSourceKey(source, field, value);
  const saved = t('settingsRoute.sourceKey.saved', { label: labelOf(typed.map((key) => key.field)) });
  return flashRedirect(back, 'ok', sourceUnlocked(source, await getSourceKeys()) ? sentences(saved, t('settings.readyAddItOnCompanies')) : saved);
});

settingsRoute.post('/settings/ai/test', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', t(UNKNOWN_ENGINE));
  const result = await testAiEngine(provider);
  return flashRedirect('/settings?tab=ai', result.ok ? 'ok' : 'err', result.text);
});

/** #412: scored postings read again on one engine, beside the scores on record — a run on the progress page. */
settingsRoute.post('/settings/ai/trial', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider)) return flashRedirect('/settings?tab=ai', 'err', t(UNKNOWN_ENGINE));
  const started = await startEngineTrial(provider);
  if ('refused' in started) return flashRedirect('/settings?tab=ai', 'err', started.refused);
  return c.redirect(`/target/runs/${started.runId}`, 303);
});

const MAX_MODEL_ID_CHARS = 100;

function cleanModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

settingsRoute.post('/settings/classifier-mode', async (c) => {
  const form = await c.req.parseBody();
  const mode = choiceParam(form.mode, ['single', 'two_stage'] as const);
  if (mode === null) return flashRedirect('/settings?tab=ai', 'err', t('http.noChoice'));
  await setClassifierMode(mode);
  return flashRedirect('/settings?tab=ai', 'ok', t(mode === 'two_stage' ? 'settingsRoute.classifier.twoStage' : 'settingsRoute.classifier.single'));
});

settingsRoute.post('/settings/application-tracking-toggle', async (c) => {
  const on = switchParam((await c.req.parseBody()).on);
  if (on === null) return flashRedirect('/settings?tab=applications', 'err', t('http.noSwitchState'));
  await setApplicationTrackingEnabled(on);
  return flashRedirect('/settings?tab=applications', 'ok', t(on ? 'settingsRoute.tracking.enabled' : 'settingsRoute.tracking.disabled'));
});

// ---- Board columns (ADR 0025) ------------------------------------------

const STAGES_BACK = '/settings?tab=applications#stages';

const STAGE_ERROR_TEXT = {
  'empty-label': 'settingsRoute.stages.emptyLabel',
  'duplicate-label': 'settingsRoute.stages.duplicateLabel',
  limit: 'settingsRoute.stages.limit',
  'unknown-key': 'settingsRoute.stages.unknownKey',
  'fixed-column': 'settingsRoute.stages.fixedColumn',
  'too-long': 'settingsRoute.stages.tooLong',
  'last-column': 'settingsRoute.stages.lastColumn',
} as const satisfies Record<StageEditError, MessageKey>;

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
    return flashRedirect(STAGES_BACK, 'err', t(STAGE_ERROR_TEXT[next], { n: MAX_STAGE_LABEL }));
  }
  await setPipelineStages(next);
  return flashRedirect(STAGES_BACK, 'ok', okText);
}

settingsRoute.post('/settings/stages/add', async (c) => {
  const form = await c.req.parseBody();
  const label = typeof form.label === 'string' ? form.label : '';
  return applyStageEdit(
    (work) => addStage(work, label),
    t('settingsRoute.stages.added', { label: label.trim() }),
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
    return flashRedirect(STAGES_BACK, 'err', t('settingsRoute.stages.moveJobsOut', { n: outcome.held }));
  }
  if (outcome.kind === 'refused') {
    return flashRedirect(STAGES_BACK, 'err', t(STAGE_ERROR_TEXT[outcome.error]));
  }
  return flashRedirect(STAGES_BACK, 'ok', t('settingsRoute.stages.removed'));
});

settingsRoute.post('/settings/stages/:key/move', async (c) => {
  const key = c.req.param('key');
  const form = await c.req.parseBody();
  const dir = choiceParam(form.dir, ['up', 'down'] as const);
  if (dir === null) return flashRedirect(STAGES_BACK, 'err', t('http.noChoice'));
  return applyStageEdit((work) => moveStage(work, key, dir), t('settingsRoute.stages.orderUpdated'));
});

settingsRoute.post('/settings/stages/:key/rename', async (c) => {
  const key = c.req.param('key');
  const form = await c.req.parseBody();
  const label = typeof form.label === 'string' ? form.label : '';
  return applyStageEdit(
    (work) => renameStage(work, key, label),
    t('settingsRoute.stages.renamed'),
  );
});

/**
 * TASKS N9: turning the check on looks right away — one request — so the answer is on the page now, not on Sunday.
 * A second "on" (a double click, a resubmit) asks nothing and words the release the first one saw.
 */
settingsRoute.post('/settings/update-check-toggle', async (c) => {
  const back = '/settings?tab=general#updates';
  const enabling = switchParam((await c.req.parseBody()).on);
  if (enabling === null) return flashRedirect(back, 'err', t('http.noSwitchState'));
  const before = await getSettings();
  await setUpdateCheck(enabling);
  forgetUpdateNotice();
  if (!enabling) return flashRedirect(back, 'ok', t('settingsRoute.updates.off'));
  const latest = before.updateCheck ? before.latestVersion : await checkForUpdate();
  return flashRedirect(
    back,
    'ok',
    latest === null
      ? t('settingsRoute.updates.noAnswer')
      : isNewer(APP_VERSION, latest)
        ? t('settingsRoute.updates.newer', { latest, current: APP_VERSION })
        : t('settingsRoute.updates.latest', { current: APP_VERSION }),
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
  const back = '/settings?tab=automation#packs';
  const form = packSettingsFromForm(await c.req.parseBody({ all: true }));
  // A value the form does not offer stores nothing — not even the switch — and the flash names the field (#383).
  if (!form.ok) {
    return flashRedirect(back, 'err', t('settingsRoute.pack.notSaved', { issue: firstIssue(form.issues, packFieldLabel) }), refusedField(c.req.path, form.issues));
  }
  const pack = switchedOn(form.settings, await getPackSettings(), new Date());
  await setPackSettings(pack);
  // Off means off for what already waits: the flash says none is prepared on its own, and the queue may hold a day of them.
  const cancelled = pack.enabled ? 0 : await cancelQueuedAutoPacks();
  return flashRedirect(
    back,
    'ok',
    pack.enabled
      ? t(pack.dailyLimit === 0 ? 'settingsRoute.pack.onNoLimit' : 'settingsRoute.pack.on', {
          fit: pack.minFit,
          days: pack.maxAgeDays,
          limit: pack.dailyLimit,
        })
      : cancelled > 0
        ? t('settingsRoute.pack.offCancelled', { n: cancelled })
        : t('settingsRoute.pack.off'),
  );
});

/** #487: the dashboard's address for links in messages; an empty field takes the links out again. */
const MAX_DASHBOARD_URL_CHARS = 2_000;

settingsRoute.post('/settings/dashboard-url', async (c) => {
  const form = await c.req.parseBody();
  const typed = typeof form.url === 'string' ? form.url.trim() : '';
  const back = '/settings?tab=notifications#links';
  if (typed === '') {
    await setDashboardUrl(null);
    return flashRedirect(back, 'ok', t('settingsRoute.dashboardUrl.cleared'));
  }
  // The saved flash names the address: past this it outgrows the cookie and no message shows (#683).
  const checked = typed.length > MAX_DASHBOARD_URL_CHARS ? { ok: false as const, reason: t('flash.issue.maxChars', { n: MAX_DASHBOARD_URL_CHARS }) } : checkDashboardUrl(typed);
  if (!checked.ok) {
    const dashboard = { url: typed.slice(0, MAX_DASHBOARD_URL_CHARS), here: new URL(c.req.url).origin };
    return settingsAgain(c, { activeTab: 'notifications', dashboard }, t('settingsRoute.dashboardUrl.notSaved', { reason: checked.reason }), 'url');
  }
  await setDashboardUrl(checked.url);
  return flashRedirect(back, 'ok', t('settingsRoute.dashboardUrl.saved', { url: checked.url }));
});

/** ADR 0056: the re-apply window — one of the listed choices, or off. */
settingsRoute.post('/settings/reapply', async (c) => {
  const body = await c.req.parseBody();
  const raw = typeof body.days === 'string' ? body.days.trim() : '';
  const days = raw === '' ? null : Number(raw);
  if (days !== null && !isReapplyChoice(days)) {
    return flashRedirect('/settings?tab=applications#reapply', 'err', t('settingsRoute.reapply.invalid'));
  }
  await setReapplyDays(days);
  return flashRedirect(
    '/settings?tab=applications#reapply',
    'ok',
    days === null ? t('settingsRoute.reapply.off') : t('settingsRoute.reapply.set', { days }),
  );
});

settingsRoute.post('/settings/stale-digest-toggle', async (c) => {
  const back = '/settings?tab=notifications#messages';
  const on = switchParam((await c.req.parseBody()).on);
  if (on === null) return flashRedirect(back, 'err', t('http.noSwitchState'));
  await setStaleApplicationsDigestEnabled(on);
  return flashRedirect(back, 'ok', t(on ? 'settingsRoute.staleDigest.enabled' : 'settingsRoute.staleDigest.disabled'));
});

settingsRoute.post('/settings/employer-mode-toggle', async (c) => {
  const next = switchParam((await c.req.parseBody()).on);
  if (next === null) return flashRedirect('/settings?tab=screening', 'err', t('http.noSwitchState'));
  await setEmployerMode(next);
  setEmployerModeCache(next);
  return flashRedirect('/settings?tab=screening', 'ok', t(next ? 'settingsRoute.employer.on' : 'settingsRoute.employer.off'));
});

settingsRoute.post('/settings/screening-retention', async (c) => {
  const form = await c.req.parseBody();
  const days = retentionParam(form.days, (await getSettings()).screeningRetentionDays, SCREENING_RETENTION_DAYS);
  if (days === null) return flashRedirect('/settings?tab=screening', 'err', t('http.noChoice'));
  await setScreeningRetentionDays(days);
  return flashRedirect('/settings?tab=screening', 'ok', t('settingsRoute.retention.saved', { days }));
});

settingsRoute.post('/settings/source-health-toggle', async (c) => {
  const on = switchParam((await c.req.parseBody()).on);
  if (on === null) return flashRedirect('/settings?tab=notifications', 'err', t('http.noSwitchState'));
  await setSourceHealthAlerts(on);
  return flashRedirect('/settings?tab=notifications', 'ok', t(on ? 'settingsRoute.sourceHealth.enabled' : 'settingsRoute.sourceHealth.disabled'));
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
      ? t('settingsRoute.sources.allEnabled')
      : t('settingsRoute.sources.disabled', { list: disabled.map(sourceLabel).join(', ') }),
  );
});

/** Both channels land here; `kind` says which form it was. A real test message goes out before the row is saved. */
settingsRoute.post('/settings/targets', onceGuard(() => 'targets:add', () => '/settings?tab=notifications'), async (c) => {
  const form = await c.req.parseBody();
  const back = '/settings?tab=notifications';
  const first = (await listNotificationTargets()).length === 0;
  if (form.kind === 'discord') {
    // #607: a refusal sends the form back open with the name kept — never the webhook URL, a secret no page echoes.
    const refuse = (text: string, field?: string): Promise<Response> =>
      settingsAgain(c, { activeTab: 'notifications', discordSent: { name: str(form.name) } }, text, field);
    const parsed = DiscordTargetSchema.safeParse({ name: form.name, webhookUrl: form.webhookUrl });
    if (!parsed.success) {
      // Only the URL is marked: both forms post here, and a marked `name` would be the Telegram form's.
      const refused = refusedField(c.req.path, parsed.error.issues).field?.name;
      return refuse(t('settingsRoute.targets.invalidDiscord'), refused === 'webhookUrl' ? refused : undefined);
    }
    // Before the test message, so a repeat does not post twice to the channel.
    const same = await findSameDestination({ kind: 'DISCORD', ...parsed.data });
    if (same) return refuse(t('settingsRoute.targets.webhookExists', { name: same.name }), 'webhookUrl');
    const test = await testDiscordWebhook(parsed.data.webhookUrl);
    if (!test.ok) {
      return refuse(t('settingsRoute.targets.discordTestFailed', { reason: test.error ?? noReason() }), 'webhookUrl');
    }
    const added = await addNotificationTarget({ kind: 'DISCORD', ...parsed.data });
    if (!added) {
      return flashRedirect(back, 'err', t('settingsRoute.targets.webhookRace'));
    }
    return flashRedirect(back, 'ok', `${t('settingsRoute.targets.discordAdded', { name: parsed.data.name })}${await alertsOnForFirst(first)}`);
  }
  const parsed = TelegramTargetSchema.safeParse({
    name: form.name,
    botToken: form.botToken,
    chatId: form.chatId,
  });
  // #549: a refusal sends the form back with the name and the chat id kept — never the token, a secret no page echoes.
  const telegramSent = { name: str(form.name), chatId: str(form.chatId) };
  const refuse = (text: string, field?: string): Promise<Response> =>
    settingsAgain(c, { activeTab: 'notifications', telegramSent }, text, field);
  if (!parsed.success) {
    // #683: the field named ("Bot token: At most…"), not "name, token, chat id required" for a short token or a long name.
    const { issues } = parsed.error;
    return refuse(t('settingsRoute.targets.notAdded', { issue: firstIssue(issues, telegramFieldLabel) }), refusedField(c.req.path, issues).field?.name);
  }
  const same = await findSameDestination({ kind: 'TELEGRAM', ...parsed.data });
  if (same) return refuse(t('settingsRoute.targets.telegramExists', { name: same.name }), 'chatId');
  const test = await testTelegramTarget(parsed.data.botToken, parsed.data.chatId);
  if (!test.ok) {
    // #561: the field Telegram refused, in words — a refused token is never blamed on the chat id.
    if (test.failed === 'token') return refuse(t('settingsRoute.targets.telegramToken'), 'botToken');
    if (test.failed === 'chat') {
      return refuse(t('settingsRoute.targets.telegramChat', { bot: test.botUsername ?? '?', chat: parsed.data.chatId }), 'chatId');
    }
    return refuse(t('settingsRoute.targets.telegramTestFailed', { reason: test.error ?? noReason() }));
  }
  const added = await addNotificationTarget({ kind: 'TELEGRAM', ...parsed.data });
  if (!added) {
    return flashRedirect(back, 'err', t('settingsRoute.targets.telegramRace'));
  }
  return flashRedirect(back, 'ok', `${t('settingsRoute.targets.telegramAdded', { name: parsed.data.name, bot: test.botUsername ?? '?' })}${await alertsOnForFirst(first)}`);
});

/**
 * The first chat turns Alerts on, as a chat read from `.env` does at first boot (init.ts): a fresh install starts
 * with them off, and a person whose test message arrived was then never sent a match. The sentence that says so.
 */
async function alertsOnForFirst(first: boolean): Promise<string> {
  if (!first || (await getSettings()).telegramEnabled) return '';
  await setTelegramEnabled(true);
  return ` ${t('settingsRoute.targets.alertsOn')}`;
}

settingsRoute.post('/settings/targets/:id/toggle', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  const active = switchParam((await c.req.parseBody()).on);
  if (active === null) return flashRedirect('/settings?tab=notifications', 'err', t('http.noSwitchState'));
  if (!(await setNotificationTargetActive(id, active))) return flashRedirect('/settings?tab=notifications', 'err', t('settingsRoute.targets.toggleGone'));
  return flashRedirect('/settings?tab=notifications', 'ok', t('settingsRoute.targets.toggled'));
});

settingsRoute.post('/settings/targets/:id/delete', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  await deleteNotificationTarget(id);
  return flashRedirect('/settings?tab=notifications', 'ok', t('settingsRoute.targets.deleted'));
});

settingsRoute.post('/settings/targets/:id/test', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  const target = await prisma.notificationTarget.findUnique({ where: { id } });
  if (!target) return flashRedirect('/settings?tab=notifications', 'err', t('settingsRoute.targets.gone'));
  if (target.kind === 'DISCORD') {
    const result = await testDiscordWebhook(target.webhookUrl ?? '');
    return result.ok
      ? flashRedirect('/settings?tab=notifications', 'ok', t('settingsRoute.targets.testSent', { name: target.name }))
      : flashRedirect('/settings?tab=notifications', 'err', testFailed(target.name, result.error));
  }
  const result = await testTelegramTarget(target.botToken ?? '', target.chatId ?? '');
  if (result.ok) {
    return flashRedirect(
      '/settings?tab=notifications',
      'ok',
      t('settingsRoute.targets.testSentBot', { name: target.name, bot: result.botUsername ?? '?' }),
    );
  }
  const refused = savedChatRefusal(result.failed, { name: target.name, chatId: target.chatId ?? '', bot: result.botUsername });
  return flashRedirect('/settings?tab=notifications', 'err', refused ?? testFailed(target.name, result.error));
});

// --- Profiles ---------------------------------------------------------------

settingsRoute.post('/settings/profiles/new', onceGuard(() => 'profiles:new', () => '/settings?tab=profile'), async (c) => {
  const blank = blankSearchToReuse(await listProfiles());
  if (blank !== null) return flashRedirect(`/settings?tab=profile&profile=${blank}`, 'warn', t('settingsRoute.search.blankOpened'));
  const profile = await createProfile(blankProfileInput());
  // Born inactive (issue #50): a blank profile must never become the
  // scoring profile. The first save with real content activates it.
  return flashRedirect(
    `/settings?tab=profile&profile=${profile.id}`,
    'ok',
    t('settingsRoute.search.created'),
  );
});

// ADR 0028: run or pause one search. The primary is refused server-side —
// the hidden Run/Pause button is advisory only.
settingsRoute.post('/settings/profiles/active', async (c) => {
  const form = await c.req.parseBody();
  const id = idParam(form.id);
  const want = switchParam(form.active);
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', t(UNKNOWN_SEARCH));
  if (want === null) return flashRedirect('/settings?tab=profile', 'err', t('http.noSwitchState'));
  // Server-side half of the gate (issue #50): a search with nothing to match
  // on would admit every posting and score it on vibes.
  const target = await getProfile(id);
  if (want && target && isBlankProfile(target)) {
    return flashRedirect(
      `/settings?tab=profile&profile=${id}`,
      'err',
      t('settingsRoute.search.blankRun'),
    );
  }
  try {
    await setProfileActive(id, want);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      err instanceof Error ? err.message : t('settingsRoute.search.stateFailed'),
    );
  }
  return flashRedirect(
    '/settings?tab=profile',
    'ok',
    t(want ? 'settingsRoute.search.running' : 'settingsRoute.search.paused', { name: target?.name ?? t('settingsRoute.search.fallbackName') }),
  );
});

settingsRoute.post('/settings/profiles/activate', async (c) => {
  const form = await c.req.parseBody();
  const id = idParam(form.id);
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', t(UNKNOWN_SEARCH));
  // Server-side half of the activation gate (issue #50) — the disabled
  // Activate button is advisory only.
  const target = await getProfile(id);
  if (target && isBlankProfile(target)) {
    return flashRedirect(
      `/settings?tab=profile&profile=${id}`,
      'err',
      t('settingsRoute.search.blankPrimary'),
    );
  }
  try {
    await setActiveProfile(id);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      err instanceof Error ? err.message : t('settingsRoute.search.primaryFailed'),
    );
  }
  return flashRedirect(
    '/settings?tab=profile',
    'ok',
    t('settingsRoute.search.primaryChanged'),
  );
});

settingsRoute.post('/settings/profiles/delete', async (c) => {
  const form = await c.req.parseBody();
  const id = idParam(form.id);
  if (!Number.isFinite(id)) return flashRedirect('/settings?tab=profile', 'err', t(UNKNOWN_SEARCH));
  try {
    await deleteProfile(id);
  } catch (err) {
    return flashRedirect(
      '/settings?tab=profile',
      'err',
      err instanceof Error ? err.message : t('settingsRoute.search.deleteFailed'),
    );
  }
  return flashRedirect('/settings?tab=profile', 'ok', t('settingsRoute.search.deleted'));
});

settingsRoute.post('/settings/profiles/:id/save', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  const before = await getProfile(id);
  if (!before) {
    return flashRedirect('/settings?tab=profile', 'err', t(SEARCH_GONE));
  }

  // `all: true` is required so multi-value checkboxes (seniority,
  // remoteRegions) come back as arrays instead of just the last value.
  const form = await c.req.parseBody({ all: true });
  // #549: a refused save sends the editor back as it was typed, the field it is about marked — never the stored values.
  const refuse = async (text: string, field?: string): Promise<Response> => {
    const sent = sentProfile(before, form);
    return settingsAgain(c, { activeTab: 'profile', activeProfile: sent.profile, profileSent: sent }, text, field);
  };
  const parsed = ProfileFormSchema.safeParse(form);
  if (!parsed.success) {
    logger.warn(
      { errors: parsed.error.flatten().fieldErrors, form },
      'profile form: validation failed',
    );
    const issue = firstIssue(parsed.error.issues, profileFieldLabel);
    return refuse(t('settingsRoute.search.notSavedIssue', { issue }), refusedField(c.req.path, parsed.error.issues).field?.name);
  }
  const f = parsed.data;

  const notificationTargetId = optionalId(f.notificationTargetId);
  const resumeId = optionalId(f.resumeId);

  const { rules: priorityRules, errors: priorityErrors } =
    parsePriorityRulesText(f.priorityRules);
  if (priorityErrors.length > 0) {
    const first = priorityErrors[0]!;
    return refuse(t('settingsRoute.search.priorityRule', { line: first.line, reason: first.reason }), 'priorityRules');
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
  const resumeGone = resumeId !== null && resumeRow === null;
  const missing = missingLinkMessage({
    resumeGone,
    notificationTargetGone: notificationTargetId !== null && targetRow === null,
  });
  if (missing) return refuse(missing, resumeGone ? 'resumeId' : 'notificationTargetId');

  // Countries arrive as names, codes or flags in any spelling; an entry the
  // gazetteer does not know is an error, not a silent drop.
  const countries = resolveCountries(toStringArray(f.countries).flatMap(parseTagList));
  if (countries.unknown.length > 0) {
    return refuse(t('settingsRoute.search.countryUnknown', { list: countries.unknown.join(', ') }), 'countries');
  }

  const input = {
    name: f.name,
    stackRequired: f.stackRequired,
    roleTypes: f.roleTypes,
    stackNiceToHave: f.stackNiceToHave,
    stackExclude: f.stackExclude,
    notes: f.notes && f.notes.trim().length > 0 ? f.notes.trim() : null,
    seniority: f.seniority,
    countries: countries.codes,
    regions: toStringArray(f.regions).filter(isRegionCode),
    workplace: toStringArray(f.workplace).filter(isProfileWorkplace),
    residence: parseResidence(f.residence, isCountryCode),
    relocation: isRelocation(f.relocation) ? f.relocation : 'no',
    onsiteCities: f.onsiteCities,
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
  // When what the filter admits has changed — its fields, or the search starting to run — the next check reads
  // again the folders' files whose rows the old search turned away, and the save says so (#448).
  const foldersHint = isActive && (activated || filterChanged(before, saved)) ? await foldersReadAgainHint() : '';

  if (f.action === 'save-and-reclassify') {
    if (!isActive) {
      return flashRedirect(
        editorUrl,
        'warn',
        t('settingsRoute.search.reclassifySkipped'),
      );
    }
    const started = triggerReclassifyAsync();
    return flashRedirect(
      editorUrl,
      'ok',
      sentences(
        t(activated ? 'settingsRoute.search.savedStarted' : 'settingsRoute.search.saved'),
        t(started ? 'settingsRoute.reclassify.started' : 'settingsRoute.reclassify.joins'),
        sourcesHint,
        foldersHint,
      ),
    );
  }
  if (activated) {
    return flashRedirect(editorUrl, 'ok', sentences(t('settingsRoute.search.savedStartedNext'), sourcesHint, foldersHint));
  }
  if (!isActive && isBlankProfile(input)) {
    return flashRedirect(
      editorUrl,
      'ok',
      t('settingsRoute.search.savedStaysPaused'),
    );
  }
  return flashRedirect(editorUrl, 'ok', sentences(t('settingsRoute.search.saved'), sourcesHint, foldersHint));
});

/** "2 sources fit these countries — Companies → …", or '' when every suggested feed already runs. */
async function sourcesWaiting(search: Profile): Promise<string> {
  const tracked = await prisma.company.findMany({ select: { id: true, atsType: true, atsToken: true, active: true } });
  const waiting = suggestSources([search], tracked).filter((s) => s.state !== 'on').length;
  return waiting === 0 ? '' : t('settingsRoute.search.sourcesWaiting', { n: waiting });
}

// Prefill the editor from a resume's AI scan, then send the browser to the
// editor with the draft in it (`?draft=`) — nothing is saved until the user
// submits the profile form. With no resumes yet the card sends a file instead
// of a resumeId: it is read on the hidden scratch row the Tailor page uses,
// so the draft saves no resume either (#555).
settingsRoute.post(
  '/settings/profiles/:id/fill-from-resume',
  resumeUploadLimit('/settings?tab=profile'),
  onceGuard((c) => `fill:${c.req.param('id')}`, () => '/settings?tab=profile'),
  async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text(t('http.badId'), 400);
  const profile = await getProfile(id);
  if (!profile) return flashRedirect('/settings?tab=profile', 'err', t(SEARCH_GONE));
  const form = await c.req.parseBody();
  let resume;
  if (form.file instanceof File && form.file.size > 0) {
    const upload = await readResumeUpload(form);
    if ('error' in upload) return flashRedirect('/settings?tab=profile', 'err', upload.error);
    resume = await upsertScratchResume({ name: nameFromFilename(upload.sourceFilename), ...upload });
  } else {
    const resumeId = idParam(form.resumeId);
    if (!Number.isFinite(resumeId)) {
      return flashRedirect('/settings?tab=profile', 'err', t('settingsRoute.fill.pickResume'));
    }
    resume = await getResume(resumeId);
    if (resume?.hidden) resume = null;
  }
  if (!resume) {
    return flashRedirect('/settings?tab=profile', 'err', t('settingsRoute.fill.resumeGone'));
  }

  // Scans from before the primary-stack field (or failed ones) re-scan here.
  if (!resume.scannedAt || resume.primarySkills.length === 0) {
    const scan = await scanResume({ id: resume.id, text: resume.text });
    if (!scan) {
      return flashRedirect(
        '/settings?tab=profile',
        'err',
        t('settingsRoute.fill.scanFailed', { name: resume.name }),
      );
    }
    resume = (await getResume(resume.id)) ?? resume;
  }

  const fill = fillDraft(profile, resume);
  if (fill.empty) {
    const names = { profile: profile.name, resume: resume.name };
    const note = fill.notice.warnings[0];
    return flashRedirect(
      '/settings?tab=profile',
      'ok',
      note ? t('settingsRoute.fill.alreadyMatchesNote', { ...names, note }) : t('settingsRoute.fill.alreadyMatches', names),
    );
  }
  // A redirect, not the page itself: the address is the editor's, and a reload reads the draft again without a POST.
  return c.redirect(`/settings?tab=profile&profile=${profile.id}&draft=${resume.id}#edit`, 303);
});

/**
 * What filling `profile` from a scanned resume puts in the editor (ADR 0015):
 * its fields, and the notice that names them. A saved resume is proposed as
 * the search's own as well; the file read on the hidden scratch row never is
 * — it is no resume of the user's (#555).
 */
function fillDraft(profile: Profile, resume: ResumeSummary): { activeProfile: Profile; notice: ProfileDraftNotice; empty: boolean } {
  const draft = buildProfileDraft(profile, resume);
  const linking = !resume.hidden && profile.resumeId !== resume.id;
  return {
    activeProfile: { ...profile, ...draft.changes, ...(linking ? { resumeId: resume.id } : {}) },
    notice: {
      resumeName: resume.name,
      changed: linking ? [...draft.changed, t('profile.draft.changed.resume')] : draft.changed,
      warnings: draft.warnings,
    },
    empty: draft.changed.length === 0 && !linking,
  };
}

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
