/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { isRelocation } from '../../eligibility';
import { CronRunStatus, JobStatus, type Profile } from '@prisma/client';
import { prisma } from '../../db';
import { getAiKeys, setAiKey, setFetchingEnabled, setSetupCompleted } from '../../settings';
import { getActiveProfile, updateProfile, type ProfileInput } from '../../profiles';
import { flagOf, placeLabel, resolveCountries } from '../../countries';
import { searchPlaces } from '../../fetchers/fetch-context';
import { isAggregator } from '../source-groups';
import { beginFetchNow } from '../fetch-now';
import { passesBaseFilter } from '../../filter';
import { parsePriorityRules } from '../../priority-rules';
import { hashShortId, parseTagList, toStringArray } from '../../text-utils';
import { forgetAiProbe, getAiEngineEnv } from '../../ai-runtime';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  isAiProviderId,
  resolveAiEngine,
} from '../../ai-engine';
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
import { loadWelcomeContext } from '../welcome-facts';
import {
  WELCOME_STEPS,
  currentStep,
  isWelcomeStep,
  stepDone,
  summarizeScoreRun,
} from '../welcome-steps';

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

  const [resumes, lastSearch, aggregators, matchCount, top, waiting] = await Promise.all([
    listResumes(),
    findLastSearch(),
    countAggregators(),
    profile
      ? prisma.job.count({
          where: { fitScore: { gte: profile.minFitScore }, status: { not: JobStatus.DISMISSED } },
        })
      : 0,
    prisma.job.findMany({
      where: { fitScore: { not: null }, status: { not: JobStatus.DISMISSED } },
      orderBy: [{ fitScore: 'desc' }, { fetchedAt: 'desc' }],
      take: TOP_MATCHES,
      select: { id: true, title: true, fitScore: true, company: { select: { name: true } } },
    }),
    profile && facts.profileReady ? countWaitingUnscored(profile) : 0,
  ]);

  const resumeId = Number(c.req.query('resume'));
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
      }}
      search={{
        jobCount: facts.jobCount,
        last: lastSearch,
        runningRunId: activeFetchRun()?.id ?? null,
        aggregators,
        countries: profile?.countries.map((code) => `${flagOf(code)} ${placeLabel(code)}`) ?? [],
      }}
      profile={{
        id: profile?.id ?? 0,
        name: profile?.name ?? '',
        stackRequired: profile?.stackRequired ?? [],
        roleTypes: profile?.roleTypes ?? [],
        seniority: profile?.seniority ?? [],
        resumes: resumes.map((r) => ({ id: r.id, name: r.name })),
        draft,
      }}
      sources={{ suggestions }}
      matches={{
        scoredCount: facts.scoredCount,
        matchCount,
        minFitScore: profile?.minFitScore ?? 0,
        top: top.map((j) => ({ id: j.id, title: j.title, companyName: j.company.name, fitScore: j.fitScore })),
        waiting,
        runningRunId: findLiveRun(SCORE_RUN_KEY)?.id ?? null,
      }}
      flash={parseFlashCookie(c.req.header('cookie'))}
    />,
    200,
    { 'Set-Cookie': clearFlashCookie() },
  );
});

welcomeRoute.post('/welcome/skip', async () => {
  await setSetupCompleted();
  return flashRedirect(
    '/',
    'ok',
    'Setup skipped — everything lives in Settings. The Overview keeps a "Finish setup" link until every step is done.',
  );
});

/** Step 5's closing action: the hourly watch starts and the wizard stops greeting. */
welcomeRoute.post('/welcome/finish', async () => {
  await setFetchingEnabled(true);
  await setSetupCompleted();
  return flashRedirect('/', 'ok', 'Setup complete — the hourly watch is on. New matches land here.');
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
    return flashRedirect('/welcome?step=ai', 'err', 'That engine does not take a pasted key.');
  }
  const key = typeof form.key === 'string' ? form.key.trim() : '';
  if (key.length === 0) {
    return flashRedirect('/welcome?step=ai', 'err', 'Paste the key first.');
  }
  if (key.length > MAX_AI_KEY_LENGTH) {
    return flashRedirect(
      '/welcome?step=ai',
      'err',
      `That is ${key.length} characters — longer than any API key. Nothing saved.`,
    );
  }
  await setAiKey(provider, key);
  forgetAiProbe();
  return flashRedirect(
    '/welcome?step=ai',
    'ok',
    `${AI_PROVIDER_LABELS[provider]} key saved. Send a test message to be sure it works.`,
  );
});

/** Step 1's optional proof: one tiny live call through the engine that would serve the pipeline. */
welcomeRoute.post('/welcome/ai/test', async () => {
  const { statuses, settings } = await loadWelcomeContext();
  const chain = resolveAiEngine(settings.aiEngine, getAiEngineEnv(await getAiKeys())).chain;
  const provider = chain.find((id) => statuses[id].ok) ?? AI_PROVIDER_IDS.find((id) => statuses[id].ok);
  if (!provider) return flashRedirect('/welcome?step=ai', 'err', 'No usable AI engine detected yet.');
  const result = await testAiEngine(provider);
  return flashRedirect('/welcome?step=ai', result.ok ? 'ok' : 'err', result.text);
});

/**
 * Step 3, resume path: a new upload becomes a Resume row (first one turns
 * default), then the scan runs on the progress page and lands back here
 * with the draft. An already-scanned resume skips straight to the draft.
 */
welcomeRoute.post('/welcome/resume', resumeUploadLimit(PROFILE_STEP), async (c) => {
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
    const id = Number(form.resumeId);
    if (Number.isFinite(id)) resume = await getResume(id);
  }
  if (!resume || resume.hidden) return flashRedirect(PROFILE_STEP, 'err', 'Pick a resume file first.');
  if (resume.scannedAt && resume.primarySkills.length > 0) {
    return c.redirect(`${back}&resume=${resume.id}`, 303);
  }

  const { id, name, text } = resume;
  const { run, joined } = claimRun(`scan:${id}:${hashShortId(text)}`, {
    steps: ['scan'],
    jobTitle: '',
    resumeName: name,
    heading: { running: 'Reading your resume', failed: 'Could not read the resume' },
    subtitle: `"${name}" — headline, tools, seniority. About half a minute.`,
    backUrl: PROFILE_STEP,
    backLabel: 'Back to setup',
  });
  if (joined) return c.redirect(`/target/runs/${run.id}`, 303);
  startRun(run.id, async () => {
    const scan = await scanResume({ id, text });
    if (!scan) {
      updateRun(run.id, {
        stage: 'error',
        error: `The AI could not read "${name}" — check the web logs and try again, or answer the three questions instead.`,
      });
      return;
    }
    updateRun(run.id, {
      stage: 'done',
      resultUrl: `${back}&resume=${id}`,
      flash: `Read "${name}" — check the summary below.`,
    });
  });
  return c.redirect(`/target/runs/${run.id}`, 303);
});

/** "Yes, that's me": the draft the summary card showed becomes the profile. */
welcomeRoute.post('/welcome/profile/apply', async (c) => {
  const form = await c.req.parseBody();
  const { profile } = await loadWelcomeContext();
  const resume = await getResume(Number(form.resumeId));
  if (!profile) return flashRedirect(PROFILE_STEP, 'err', 'No primary search — create one in Settings → Profile.');
  if (!resume || !resume.scannedAt) return flashRedirect(PROFILE_STEP, 'err', 'That resume has not been read yet.');
  const draft = buildProfileDraft(profile, scanFields(resume));
  // The search is built from this resume, so it hunts with it (#158) — the
  // same link the settings route proposes when it fills from a resume.
  await updateProfile(profile.id, { ...profileInput(profile), ...draft.changes, resumeId: resume.id });
  const changed = profile.resumeId === resume.id ? draft.changed : [...draft.changed, 'resume for this search'];
  // No step named: the wizard lands on the first undone one — the sources
  // step when the new countries call for boards, the matches otherwise.
  return flashRedirect(
    '/welcome',
    'ok',
    changed.length > 0
      ? `Profile filled from "${resume.name}" — ${changed.join(', ')}. Adjust it any time in Settings → Profile.`
      : `Profile already matched "${resume.name}".`,
  );
});

/**
 * Step 3's second-resume action: the card above it showed the whole draft,
 * so one press creates the search (ADR 0015). It is born inactive — the
 * search the wizard just set up keeps running.
 */
welcomeRoute.post('/welcome/profile/create', async (c) => {
  const form = await c.req.parseBody();
  const resume = await getResume(Number(form.resumeId));
  if (!resume || resume.hidden || !resume.scannedAt) {
    return flashRedirect(PROFILE_STEP, 'err', 'That resume has not been read yet.');
  }
  const profile = await createProfileFromResume(resume);
  return flashRedirect(
    PROFILE_STEP,
    'ok',
    `Created a second search, "${profile.name}", from "${resume.name}". Your current search keeps running — switch to it on Settings → Profile.`,
  );
});

/** Step 3, no-resume path: three answers write the same fields. */
welcomeRoute.post('/welcome/profile', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const { profile } = await loadWelcomeContext();
  if (!profile) return flashRedirect(PROFILE_STEP, 'err', 'No primary search — create one in Settings → Profile.');
  const stackRequired = parseTagList(String(form.stackRequired ?? ''));
  const roleTypes = parseTagList(String(form.roleTypes ?? ''));
  const seniority = toStringArray(form.seniority).filter((s) =>
    (SENIORITY_LEVELS as readonly string[]).includes(s),
  );
  if (stackRequired.length === 0 && roleTypes.length === 0) {
    return flashRedirect(PROFILE_STEP, 'err', 'Add at least one technology or one role word.');
  }
  await updateProfile(profile.id, { ...profileInput(profile), stackRequired, roleTypes, seniority });
  return flashRedirect('/welcome', 'ok', 'Profile saved. Adjust it any time in Settings → Profile.');
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
    return flashRedirect(SEARCH_STEP, 'err', `Country not recognised: ${typed.unknown.join(', ')} — pick one from the list.`);
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
    return flashRedirect(PROFILE_STEP, 'err', 'Fill the profile first — scoring needs your technologies or role words.');
  }
  // Step 1 can be skipped, and then every call in this pass fails one by one:
  // a minute of watching a progress bar to be told nothing could be scored.
  // The wizard already knows whether an engine answers — ask it first.
  if (!facts.aiReady) {
    return flashRedirect(
      AI_STEP,
      'err',
      'No AI engine answered, so there is nothing to score with. Connect one here first — the jobs we found are already stored and stay put.',
    );
  }
  const { run, joined } = claimRun(SCORE_RUN_KEY, {
    steps: ['score'],
    jobTitle: '',
    resumeName: '',
    heading: { running: 'Scoring the jobs we found', failed: 'Scoring failed' },
    subtitle: `The ${SCORE_BATCH} stored jobs that match your profile best — seconds each on an API engine, up to half a minute on a CLI one.`,
    backUrl: MATCHES_STEP,
    backLabel: 'Back to setup',
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
    telegramTargetId: p.telegramTargetId,
    resumeId: p.resumeId,
    priorityRules: parsePriorityRules(p.priorityRules),
  };
}
