import type { EngineTrial, Prisma, Profile } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { AI_PROVIDER_LABELS, missingCredentials, providerUnusable, resolveAiEngine, type AiProviderId } from '../ai-engine';
import { getAiEngineEnv } from '../ai-runtime';
import type { AiBilling } from '../ai-usage';
import { classifyOnEngine } from '../classifier';
import { companyForPrompt } from '../employer';
import { buildVerdicts } from '../jobs/verdict-merge';
import { isBlankProfile } from '../profile-guards';
import { listActiveProfiles } from '../profiles';
import { getAiKeys, getSettings } from '../settings';
import { t } from '../i18n/t';
import { trialCostHint } from './cost-hint';
import {
  pickTrialSample,
  recordedVerdicts,
  trialGivesUp,
  trialLine,
  trialModel,
  trialPairs,
  trialReport,
  TRIAL_MIN,
  TRIAL_SIZE,
  type TrialReading,
} from './engine-trial';
import { claimRun, startRun, updateRun } from './target-runs';

/*
 * The engine trial's I/O (#412): the sample out of the database, one call per
 * posting on the one engine, the result kept per engine and model. The only
 * file that touches `engine_trial`; the decisions are engine-trial.ts.
 */

/** The newest scored postings a sample is picked from: enough to fill every band. */
const CANDIDATES_READ = 500;
/** Calls that all went unanswered before a run stops: the rest would not answer either. */
const GIVE_UP_AFTER = 2;
/** Twenty calls on a slow model on this computer can outlast the half hour a run is kept. */
const TRIAL_RUN_KEEP_MS = 2 * 60 * 60_000;
const SETTINGS_AI = '/settings?tab=ai';

/** A posting that carries a score for a search that runs today. */
function scoredFor(profiles: readonly Profile[]): Prisma.JobWhereInput {
  return { fitScore: { not: null }, scores: { some: { profileId: { in: profiles.map((p) => p.id) } } } };
}

/** The searches a trial reads with: the running ones the tick would score with (issue #50). */
async function trialProfiles(): Promise<Profile[]> {
  return (await listActiveProfiles()).filter((p) => !isBlankProfile(p));
}

/** What an engine card shows about a trial on its classifier model. */
export interface TrialView {
  /** The model a press reads with, worded; null when the local engine has none yet. */
  model: string | null;
  /** False under TRIAL_MIN scored postings: the button waits and `note` says why. */
  ready: boolean;
  /** The cost line, or why there is nothing to try yet. */
  note: string;
  last: { at: Date; text: string } | null;
}

/** The trial block of every engine in `ids`, read once for the page. */
export async function trialViews(
  ids: readonly AiProviderId[],
  modelOf: (id: AiProviderId) => string,
  billingOf: (id: AiProviderId) => AiBilling,
): Promise<Map<AiProviderId, TrialView>> {
  const profiles = await trialProfiles();
  const [scored, trials] = await Promise.all([
    profiles.length > 0 ? prisma.job.count({ where: scoredFor(profiles) }) : 0,
    prisma.engineTrial.findMany(),
  ]);
  const postings = Math.min(scored, TRIAL_SIZE);
  const ready = scored >= TRIAL_MIN;
  const views = await Promise.all(
    ids.map(async (id): Promise<[AiProviderId, TrialView]> => {
      const model = modelOf(id);
      const worded = trialModel(id, model);
      const last = trials.find((row) => row.engine === id && row.model === model);
      return [
        id,
        {
          model: worded,
          ready: ready && worded !== null,
          note:
            worded === null
              ? t('trial.needsModel')
              : ready
                ? await trialCostHint(id, model, billingOf(id), postings)
                : t('trial.needsScored', { min: TRIAL_MIN, n: scored }),
          last: last ? { at: last.at, text: trialLine(last) } : null,
        },
      ];
    }),
  );
  return new Map(views);
}

/** The last trial of each engine on the model its classifier slot names today — what the AI usage hints cite. */
export async function currentTrials(modelOf: (id: AiProviderId) => string): Promise<Partial<Record<AiProviderId, EngineTrial>>> {
  const rows = await prisma.engineTrial.findMany();
  return Object.fromEntries(rows.filter((row) => row.model === modelOf(row.engine as AiProviderId)).map((row) => [row.engine, row]));
}

/**
 * Starts a trial of `provider` on its classifier model, or says why not. A
 * second press while one runs joins it, as every run on the progress page does.
 */
export async function startEngineTrial(provider: AiProviderId): Promise<{ runId: string } | { refused: string }> {
  const label = AI_PROVIDER_LABELS[provider];
  const [settings, keys] = await Promise.all([getSettings(), getAiKeys()]);
  const env = getAiEngineEnv(keys, settings.openAiBaseUrl);
  if (providerUnusable(provider, env)) return { refused: missingCredentials(provider) };
  const model = resolveAiEngine(settings.aiEngine, env).modelFor(provider, 'classifier');
  const worded = trialModel(provider, model);
  if (worded === null) return { refused: t('trial.needsModel') };
  const profiles = await trialProfiles();
  const candidates =
    profiles.length > 0
      ? await prisma.job.findMany({
          where: scoredFor(profiles),
          orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
          take: CANDIDATES_READ,
          select: { id: true, fitScore: true },
        })
      : [];
  const scored = candidates.flatMap((row) => (row.fitScore === null ? [] : [{ id: row.id, fitScore: row.fitScore }]));
  if (scored.length < TRIAL_MIN) return { refused: t('trial.needsScored', { min: TRIAL_MIN, n: scored.length }) };
  const sample = pickTrialSample(scored);
  const { run, joined } = claimRun(`trial:${provider}:${model}`, {
    steps: ['trial'],
    jobTitle: '',
    resumeName: '',
    heading: { running: t('trial.run.running', { engine: label }), failed: t('trial.run.failed') },
    subtitle: t('trial.run.subtitle', { n: sample.length, model: worded }),
    backUrl: SETTINGS_AI,
    backLabel: t('trial.run.back'),
    keepMs: TRIAL_RUN_KEEP_MS,
  });
  if (!joined) {
    startRun(run.id, () => runTrial(run.id, provider, model, profiles, sample.map((row) => row.id)));
  }
  return { runId: run.id };
}

async function runTrial(runId: string, provider: AiProviderId, model: string, profiles: Profile[], ids: number[]): Promise<void> {
  const label = AI_PROVIDER_LABELS[provider];
  const rows = await prisma.job.findMany({
    where: { id: { in: ids } },
    include: { company: { select: { name: true, atsType: true } }, scores: { where: { profileId: { in: profiles.map((p) => p.id) } } } },
  });
  const jobs = ids.flatMap((id) => rows.filter((row) => row.id === id));
  const readings: TrialReading[] = [];
  let reason = '';
  for (const job of jobs) {
    updateRun(runId, { progress: { done: readings.length, total: jobs.length } });
    const started = Date.now();
    const out = await classifyOnEngine(
      {
        title: job.title,
        companyName: companyForPrompt(job.employer, job.company),
        location: job.location,
        place: { workplace: job.workplace, countries: job.countries, regions: job.regions },
        description: job.description,
        postedAt: job.postedAt,
      },
      profiles,
      provider,
      (why) => {
        reason = why;
      },
    );
    const ms = Date.now() - started;
    readings.push(
      !out
        ? { kind: 'failed' }
        : !out.parsed
          ? { kind: 'unparsed', ms }
          : { kind: 'read', ms, pairs: trialPairs(buildVerdicts(out.parsed.results, profiles, job).verdicts, recordedVerdicts(job, job.scores, profiles)) },
    );
    if (trialGivesUp(readings, GIVE_UP_AFTER)) break;
  }
  const report = trialReport(readings);
  if (report.failed === report.postings) {
    updateRun(runId, { stage: 'error', error: reason ? t('trial.run.noAnswer', { engine: label, reason }) : t('trial.run.noAnswerNoReason', { engine: label }) });
    return;
  }
  await prisma.engineTrial.upsert({
    where: { engine_model: { engine: provider, model } },
    create: { engine: provider, model, ...report },
    update: { ...report, at: new Date() },
  });
  logger.info({ engine: provider, model, ...report }, 'trial: scored postings read again');
  updateRun(runId, {
    stage: 'done',
    resultUrl: SETTINGS_AI,
    flash: `${t('trial.run.done', { engine: label, n: report.postings })} ${trialLine(report)}`,
  });
}
