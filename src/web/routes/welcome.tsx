/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { idParam } from '../params';
import { onceGuard } from '../once-guard';
import { isRelocation } from '../../eligibility';
import { CronRunStatus, JobStatus, type Profile } from '@prisma/client';
import { prisma } from '../../db';
import { config } from '../../config';
import {
  getAiKeys,
  getSettings,
  setAiEngineConfig,
  setAiKey,
  setFetchingEnabled,
  setLocalAiUrl,
  setOpenAiBaseUrl,
  setSetupCompleted,
} from '../../settings';
import { getActiveProfile, updateProfile, type ProfileInput } from '../../profiles';
import { flagOf, resolveCountries } from '../../countries';
import { searchPlaces } from '../../fetchers/fetch-context';
import { isAggregator } from '../source-groups';
import { beginFetchNow } from '../fetch-now';
import { passesBaseFilter } from '../../filter';
import { parsePriorityRules } from '../../priority-rules';
import { hashShortId, parseTagList, toStringArray } from '../../text-utils';
import { forgetAiProbe, getAiEngineEnv, localAiBase } from '../../ai-runtime';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  aiEngineOrder,
  isAiProviderId,
  parseAiEngineConfig,
  resolveAiEngine,
  withEngineFirst,
} from '../../ai-engine';
import { checkLocalAiUrl, checkOpenAiBaseUrl, isLocalUrl } from '../../ai-usage';
import { findLocalServers, listOllamaModels, listServerModels, preferredModel } from '../../server-models';
import { AI_KEY_ENV_VARS, MAX_AI_KEY_LENGTH, providerTakesKey } from '../../ai-keys';
import { createResume, getResume, listResumes, type ResumeSummary } from '../../resume/store';
import { scanResume } from '../../resume/scan';
import {
  buildProfileDraft,
  SENIORITY_LEVELS,
  type ProfileForDraft,
} from '../../resume/profile-draft';
import { createProfileFromResume, newProfileDraft, scanFields } from '../profile-from-resume';
import { recordCronRun, type CronStats } from '../../jobs/cron-run';
import { runScoreUnscored, SCORE_BATCH } from '../../jobs/reclassify-job';
import { activeFetchRun } from '../fetch-runs';
import { claimRun, findLiveRun, startRun, updateRun } from '../target-runs';
import { testAiEngine } from '../ai-test';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { nameFromFilename, readResumeUpload, resumeUploadLimit } from '../upload';
import { WelcomePage, type LastSearch, type ProfileDraftCard } from '../pages/welcome';
import { packOffers } from '../pack-offers';
import { loadWelcomeContext } from '../welcome-facts';
import {
  WELCOME_STEPS,
  currentStep,
  isWelcomeStep,
  stepDone,
  summarizeScoreRun,
} from '../welcome-steps';
import { spendHint } from '../cost-hint';
import { currentLocale } from '../../i18n/locale';
import { placeName } from '../../i18n/places';
import { t } from '../../i18n/t';

const TOP_MATCHES = 5;
const AI_STEP = '/welcome?step=ai';
const SEARCH_STEP = '/welcome?step=search';
const PROFILE_STEP = '/welcome?step=profile';
const MATCHES_STEP = '/welcome?step=matches';

/** The scoring pass in flight, if any — one at a time, like re-classify. */
const SCORE_RUN_KEY = 'score';

export const welcomeRoute = new Hono();

welcomeRoute.get('/welcome', async (c) => {
  const { facts, settings, statuses, profile, suggestions } = await loadWelcomeContext();
  const requested = c.req.query('step');
  const current = isWelcomeStep(requested) ? requested : currentStep(facts);

  const [resumes, lastSearch, aggregators, packs, matchCount, top, waiting, localServers] = await Promise.all([
    listResumes(),
    findLastSearch(),
    countAggregators(),
    packOffers(),
    profile
      ? prisma.job.count({
          where: { fitScore: { gte: profile.minFitScore }, status: { not: JobStatus.DISMISSED } },
        })
      : 0,
    prisma.job.findMany({
      where: { fitScore: { not: null }, status: { not: JobStatus.DISMISSED } },
      orderBy: [{ fitScore: 'desc' }, { fetchedAt: 'desc' }],
      take: TOP_MATCHES,
      select: { id: true, title: true, employer: true, fitScore: true, company: { select: { name: true } } },
    }),
    profile && facts.profileReady ? countWaitingUnscored(profile) : 0,
    // One local request per default address, on step 1 only — no other step asks.
    current === 'ai' ? findLocalServers() : [],
  ]);
  const first = aiEngineOrder(parseAiEngineConfig(settings.aiEngine), config.AI_PROVIDER)[0];
  // The found server the engine at the top of the list already talks to, if any.
  const inUse = first === 'local_api' ? localAiBase(settings.localAiUrl) : first === 'openai_api' ? settings.openAiBaseUrl : null;

  const resumeId = idParam(c.req.query('resume'));
  const asNew = c.req.query('mode') === 'new';
  const draftResume = Number.isFinite(resumeId) && profile ? await getResume(resumeId) : null;
  const draft = draftResume && profile ? draftCard(profile, draftResume, asNew) : null;

  return c.html(
    <WelcomePage
      steps={WELCOME_STEPS.map((key) => ({ key, done: stepDone(key, facts) }))}
      current={current}
      setupCompleted={settings.setupCompletedAt !== null}
      fetchingEnabled={settings.fetchingEnabled}
      telegramEnabled={settings.telegramEnabled}
      ai={{
        engines: AI_PROVIDER_IDS.map((id) => ({
          id,
          label: AI_PROVIDER_LABELS[id],
          keyEnvVar: providerTakesKey(id) ? AI_KEY_ENV_VARS[id] : null,
          ...statuses[id],
        })),
        local: {
          servers: localServers.map((s) => ({ ...s, host: new URL(s.base).host, preferred: preferredModel(s.models) })),
          inUse,
        },
      }}
      search={{
        jobCount: facts.jobCount,
        last: lastSearch,
        runningRunId: activeFetchRun()?.id ?? null,
        aggregators,
        countries: profile?.countries.map(countryChip) ?? [],
      }}
      profile={{
        id: profile?.id ?? 0,
        name: profile?.name ?? '',
        stackRequired: profile?.stackRequired ?? [],
        roleTypes: profile?.roleTypes ?? [],
        seniority: profile?.seniority ?? [],
        resumes: resumes.map((r) => ({ id: r.id, name: r.name })),
        draft,
        scanCost: await spendHint('resume-scan'),
      }}
      sources={{ suggestions, packs }}
      matches={{
        scoredCount: facts.scoredCount,
        matchCount,
        minFitScore: profile?.minFitScore ?? 0,
        top: top.map((j) => ({ id: j.id, title: j.title, companyName: j.employer ?? j.company.name, fitScore: j.fitScore })),
        waiting,
        runningRunId: findLiveRun(SCORE_RUN_KEY)?.id ?? null,
        scoreCost: await spendHint('classifier'),
      }}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

welcomeRoute.post('/welcome/skip', async () => {
  await setSetupCompleted(currentLocale());
  return flashRedirect('/', 'ok', t('welcome.flash.skipped'));
});

/** Step 5's closing action: the hourly watch starts and the wizard stops greeting. */
welcomeRoute.post('/welcome/finish', async () => {
  await setFetchingEnabled(true);
  await setSetupCompleted(currentLocale());
  return flashRedirect('/', 'ok', t('welcome.flash.finished'));
});

/**
 * Step 1's paste-a-key path (ADR 0027): the credential lands in the database,
 * the probe cache is dropped so the page shows the engine as connected right
 * away, and the Test button next to it proves the connection for real.
 */
welcomeRoute.post('/welcome/ai/key', async (c) => {
  const form = await c.req.parseBody();
  const provider = typeof form.provider === 'string' ? form.provider : '';
  if (!isAiProviderId(provider) || !providerTakesKey(provider)) {
    return flashRedirect('/welcome?step=ai', 'err', t('welcome.flash.noKeyEngine'));
  }
  const key = typeof form.key === 'string' ? form.key.trim() : '';
  if (key.length === 0) {
    return flashRedirect('/welcome?step=ai', 'err', t('welcome.flash.keyEmpty'));
  }
  if (key.length > MAX_AI_KEY_LENGTH) {
    return flashRedirect('/welcome?step=ai', 'err', t('welcome.flash.keyTooLong', { n: key.length }));
  }
  await setAiKey(provider, key);
  forgetAiProbe();
  return flashRedirect('/welcome?step=ai', 'ok', t('welcome.flash.keySaved', { engine: AI_PROVIDER_LABELS[provider] }));
});

/**
 * Step 1's "Use it" on a model found on this computer (TASKS S1): the address
 * is stored for the engine that server is used through — Ollama's own API
 * (ADR 0057), or the OpenAI-compatible one for LM Studio — that engine goes
 * first with the model in every slot, and whatever was in the list stays
 * behind it as the fallback.
 */
welcomeRoute.post('/welcome/ai/local', async (c) => {
  const form = await c.req.parseBody();
  const engine = form.engine === 'local_api' ? 'local_api' : 'openai_api';
  const checked = engine === 'local_api' ? checkLocalAiUrl(typeof form.base === 'string' ? form.base : '') : checkOpenAiBaseUrl(typeof form.base === 'string' ? form.base : '');
  if (!checked.ok || !isLocalUrl(checked.url)) return flashRedirect(AI_STEP, 'err', t('welcome.flash.notLocal'));
  const listed = engine === 'local_api' ? await listOllamaModels(checked.url) : await listServerModels(checked.url, undefined);
  if ('reason' in listed) return flashRedirect(AI_STEP, 'err', t('welcome.flash.localUnlisted', { reason: listed.reason }));
  const model = typeof form.model === 'string' ? form.model.trim() : '';
  if (!listed.models.includes(model)) {
    return flashRedirect(AI_STEP, 'err', t('welcome.flash.modelUnknown', { model }));
  }
  await (engine === 'local_api' ? setLocalAiUrl(checked.url) : setOpenAiBaseUrl(checked.url));
  const [settings, keys] = await Promise.all([getSettings(), getAiKeys()]);
  await setAiEngineConfig(withEngineFirst(parseAiEngineConfig(settings.aiEngine), engine, getAiEngineEnv(keys, settings.openAiBaseUrl), model));
  forgetAiProbe();
  return flashRedirect(AI_STEP, 'ok', t('welcome.flash.localFirst', { model }));
});

/** Step 1's optional proof: one tiny live call through the engine that would serve the pipeline. */
welcomeRoute.post('/welcome/ai/test', async () => {
  const { statuses, settings } = await loadWelcomeContext();
  const chain = resolveAiEngine(settings.aiEngine, getAiEngineEnv(await getAiKeys(), settings.openAiBaseUrl)).chain;
  const provider = chain.find((id) => statuses[id].ok) ?? AI_PROVIDER_IDS.find((id) => statuses[id].ok);
  if (!provider) return flashRedirect('/welcome?step=ai', 'err', t('welcome.flash.noEngine'));
  const result = await testAiEngine(provider);
  return flashRedirect('/welcome?step=ai', result.ok ? 'ok' : 'err', result.text);
});

/**
 * Step 3, resume path: a new upload becomes a Resume row (first one turns
 * default), then the scan runs on the progress page and lands back here
 * with the draft. An already-scanned resume skips straight to the draft.
 */
welcomeRoute.post('/welcome/resume', resumeUploadLimit(PROFILE_STEP), onceGuard(() => 'welcome:resume', () => PROFILE_STEP), async (c) => {
  const form = await c.req.parseBody();
  // "A second search" (§4 stage A) drafts a new profile instead of filling
  // the active one; the flag rides through the scan run in the result URL.
  const back = form.mode === 'new' ? `${PROFILE_STEP}&mode=new` : PROFILE_STEP;
  let resume: ResumeSummary | null = null;
  if (form.file instanceof File && form.file.size > 0) {
    const upload = await readResumeUpload(form);
    if ('error' in upload) return flashRedirect(PROFILE_STEP, 'err', upload.error);
    resume = await createResume({ name: nameFromFilename(upload.sourceFilename), ...upload });
  } else {
    const id = idParam(form.resumeId);
    if (Number.isFinite(id)) resume = await getResume(id);
  }
  if (!resume || resume.hidden) return flashRedirect(PROFILE_STEP, 'err', t('welcome.flash.pickResume'));
  if (resume.scannedAt && resume.primarySkills.length > 0) {
    return c.redirect(`${back}&resume=${resume.id}`, 303);
  }

  const { id, name, text } = resume;
  const { run, joined } = claimRun(`scan:${id}:${hashShortId(text)}`, {
    steps: ['scan'],
    jobTitle: '',
    resumeName: name,
    heading: { running: t('welcome.scanRun.running'), failed: t('welcome.scanRun.failed') },
    subtitle: t('welcome.scanRun.subtitle', { name }),
    backUrl: PROFILE_STEP,
    backLabel: t('fetch.backToSetup'),
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const scan = await scanResume({ id, text });
    if (!scan) {
      updateRun(run.id, {
        stage: 'error',
        error: t('welcome.scanRun.error', { name }),
      });
      return;
    }
    updateRun(run.id, {
      stage: 'done',
      resultUrl: `${back}&resume=${id}`,
      flash: t('welcome.scanRun.done', { name }),
    });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/** "Yes, that's me": the draft the summary card showed becomes the profile. */
welcomeRoute.post('/welcome/profile/apply', async (c) => {
  const form = await c.req.parseBody();
  const { profile } = await loadWelcomeContext();
  const resume = await getResume(idParam(form.resumeId));
  if (!profile) return flashRedirect(PROFILE_STEP, 'err', t('welcome.flash.noPrimary'));
  if (!resume || !resume.scannedAt) return flashRedirect(PROFILE_STEP, 'err', t('welcome.flash.notScanned'));
  const draft = buildProfileDraft(profile, scanFields(resume));
  // The search is built from this resume, so it hunts with it (#158) — the
  // same link the settings route proposes when it fills from a resume.
  await updateProfile(profile.id, { ...profileInput(profile), ...draft.changes, resumeId: resume.id });
  const changed = profile.resumeId === resume.id ? draft.changed : [...draft.changed, t('welcome.flash.changedResume')];
  // No step named: the wizard lands on the first undone one — the sources
  // step when the new countries call for boards, the matches otherwise.
  return flashRedirect(
    '/welcome',
    'ok',
    changed.length > 0
      ? t('welcome.flash.profileFilled', { name: resume.name, changed: changed.join(', ') })
      : t('welcome.flash.profileSame', { name: resume.name }),
  );
});

/**
 * Step 3's second-resume action: the card above it showed the whole draft,
 * so one press creates the search (ADR 0015). It is born inactive — the
 * search the wizard just set up keeps running.
 */
welcomeRoute.post('/welcome/profile/create', async (c) => {
  const form = await c.req.parseBody();
  const resume = await getResume(idParam(form.resumeId));
  if (!resume || resume.hidden || !resume.scannedAt) {
    return flashRedirect(PROFILE_STEP, 'err', t('welcome.flash.notScanned'));
  }
  const profile = await createProfileFromResume(resume);
  return flashRedirect(PROFILE_STEP, 'ok', t('welcome.flash.secondCreated', { profile: profile.name, resume: resume.name }));
});

/** Step 3, no-resume path: three answers write the same fields. */
welcomeRoute.post('/welcome/profile', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const { profile } = await loadWelcomeContext();
  if (!profile) return flashRedirect(PROFILE_STEP, 'err', t('welcome.flash.noPrimary'));
  const stackRequired = parseTagList(String(form.stackRequired ?? ''));
  const roleTypes = parseTagList(String(form.roleTypes ?? ''));
  const seniority = toStringArray(form.seniority).filter((s) =>
    (SENIORITY_LEVELS as readonly string[]).includes(s),
  );
  if (stackRequired.length === 0 && roleTypes.length === 0) {
    return flashRedirect(PROFILE_STEP, 'err', t('welcome.flash.profileEmpty'));
  }
  await updateProfile(profile.id, { ...profileInput(profile), stackRequired, roleTypes, seniority });
  return flashRedirect('/welcome', 'ok', t('welcome.flash.profileSaved'));
});

/** Step 5: score the stored-unscored jobs on the progress page; one pass at a time. */
/**
 * Step 2's test search: the aggregators alone — they need no company row and
 * answer with hundreds of postings each, while the company boards cost most
 * of the requests and add little to a first impression (measured in
 * docs/onboarding-sources.md; Decision B). A country typed here lands on the
 * primary search before the walk, so the boards that narrow by place do, the
 * profile step starts from it, and the sources step can offer for it.
 */
welcomeRoute.post('/welcome/search', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const typed = resolveCountries(toStringArray(form.countries).flatMap(parseTagList));
  if (typed.unknown.length > 0) {
    return flashRedirect(SEARCH_STEP, 'err', t('welcome.flash.countryUnknown', { names: typed.unknown.join(', ') }));
  }
  let profile = await getActiveProfile();
  if (profile && typed.codes.length > 0) {
    profile = await updateProfile(profile.id, { ...profileInput(profile), countries: typed.codes });
  }
  const run = await beginFetchNow({
    backUrl: '/welcome',
    scope: 'aggregators',
    places: profile ? searchPlaces([profile]) : undefined,
  });
  return c.redirect(`/runs/fetch-now/${run.id}`, 303);
});

welcomeRoute.post('/welcome/score', async (c) => {
  const { facts } = await loadWelcomeContext();
  if (!facts.profileReady) {
    return flashRedirect(PROFILE_STEP, 'err', t('welcome.flash.profileFirst'));
  }
  // Step 1 can be skipped, and then every call in this pass fails one by one:
  // a minute of watching a progress bar to be told nothing could be scored.
  // The wizard already knows whether an engine answers — ask it first.
  if (!facts.aiReady) {
    return flashRedirect(AI_STEP, 'err', t('welcome.flash.noAi'));
  }
  const { run, joined } = claimRun(SCORE_RUN_KEY, {
    steps: ['score'],
    jobTitle: '',
    resumeName: '',
    heading: { running: t('welcome.scoreRun.running'), failed: t('welcome.scoreRun.failed') },
    subtitle: t('welcome.scoreRun.subtitle', { n: SCORE_BATCH }),
    backUrl: MATCHES_STEP,
    backLabel: t('fetch.backToSetup'),
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    let stats: CronStats = {};
    await recordCronRun('score-unscored', async () => {
      const out = await runScoreUnscored({
        limit: SCORE_BATCH,
        onProgress: (done, total) => updateRun(run.id, { progress: { done, total } }),
      });
      stats = out.stats;
      return out;
    });
    updateRun(run.id, { stage: 'done', resultUrl: MATCHES_STEP, flash: summarizeScoreRun(stats).text });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/* ---------- helpers ---------- */

/**
 * A country as step 2's chip shows it: its flag and its name in the reader's
 * language. The chip comes back through parseTagList, which splits on commas,
 * so a name with one ("Гонконг, ОАР Китаю") keeps its first part — the flag
 * is what resolves it either way.
 */
function countryChip(code: string): string {
  return `${flagOf(code)} ${placeName(code).split(',')[0]}`;
}

/** The aggregators switched on — what step 2 asks. */
async function countAggregators(): Promise<number> {
  const rows = await prisma.company.findMany({ where: { active: true }, select: { atsType: true } });
  return rows.filter(isAggregator).length;
}

/** The last search that actually ran — a paused-skip row carries no counts. */
async function findLastSearch(): Promise<LastSearch | null> {
  const rows = await prisma.cronRun.findMany({
    where: { name: { in: ['fetch-now', 'fetch'] }, status: CronRunStatus.OK },
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: { stats: true },
  });
  for (const row of rows) {
    const s = row.stats as Record<string, unknown> | null;
    if (s && typeof s.fetched === 'number') {
      const n = (key: string): number => (typeof s[key] === 'number' ? (s[key] as number) : 0);
      return { fetched: n('fetched'), sources: n('sources'), failed: n('sourcesFailed'), stored: n('persisted'), durationMs: n('durationMs') };
    }
  }
  return null;
}

/** Stored-unscored jobs that pass the profile's words — what one "Score" press would read. */
async function countWaitingUnscored(profile: Profile): Promise<number> {
  const rows = await prisma.job.findMany({
    where: { fitScore: null, status: JobStatus.NEW },
    select: { title: true, location: true, workplace: true, countries: true, regions: true },
  });
  return rows.filter((j) => passesBaseFilter(j, profile)).length;
}

/** asNew drafts a second search off a blank base; otherwise it fills `profile`. */
function draftCard(
  profile: ProfileForDraft,
  resume: ResumeSummary,
  asNew: boolean,
): ProfileDraftCard | null {
  if (!resume.scannedAt || resume.hidden) return null;
  const draft = asNew ? newProfileDraft(resume) : buildProfileDraft(profile, scanFields(resume));
  const primary = draft.changes.stackRequired ?? resume.primarySkills;
  return {
    asNew,
    profileName: draft.changes.name ?? profile.name,
    resumeId: resume.id,
    resumeName: resume.name,
    title: resume.title,
    primarySkills: primary,
    skillCount: Math.max(0, resume.skills.length - primary.length),
    seniority: resume.seniority,
    roleTypes: draft.changes.roleTypes ?? resume.roleTypes,
    changed: draft.changed,
    warnings: draft.warnings,
  };
}

/** A stored Profile row as the input shape updateProfile takes. */
function profileInput(p: Profile): ProfileInput {
  return {
    residence: p.residence,
    relocation: isRelocation(p.relocation) ? p.relocation : 'no',
    name: p.name,
    stackRequired: p.stackRequired,
    roleTypes: p.roleTypes,
    stackNiceToHave: p.stackNiceToHave,
    stackExclude: p.stackExclude,
    notes: p.notes,
    seniority: p.seniority,
    countries: p.countries,
    regions: p.regions,
    workplace: p.workplace,
    onsiteCities: p.onsiteCities,
    minSalaryUsd: p.minSalaryUsd,
    minFitScore: p.minFitScore,
    notificationTargetId: p.notificationTargetId,
    resumeId: p.resumeId,
    priorityRules: parsePriorityRules(p.priorityRules),
  };
}
