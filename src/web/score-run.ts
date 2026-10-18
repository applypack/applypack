import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { withoutMuted } from '../employer';
import { mutedKeys } from '../jobs/employer-store';
import { recordCronRun, type CronStats } from '../jobs/cron-run';
import { runScoreUnscored } from '../jobs/reclassify-job';
import { claimRun, findLiveRun, startRun, updateRun, type TargetRun } from './target-runs';
import { summarizeScoreRun } from './welcome-steps';
import { spendHint } from './cost-hint';
import type { UnscoredView } from './pages/unscored-notice';

/** One pass at a time, whether setup's last step or the Jobs page started it: both read the same unscored rows. */
const SCORE_RUN_KEY = 'score';

/** What one press on the Jobs page scores at most: a backlog of a few dozen in one go, never an unbounded spend. */
export const PAGE_SCORE_BATCH = 50;

export function liveScoreRun(): TargetRun | null {
  return findLiveRun(SCORE_RUN_KEY);
}

/**
 * Scores the best `limit` of the jobs stored unscored (`runScoreUnscored`),
 * on the shared progress page; a press while one runs joins it. The verdict
 * lands on `resultUrl` as a flash.
 */
export function beginScoreUnscored(
  opts: { limit: number; resultUrl: string } & Pick<TargetRun, 'heading' | 'subtitle' | 'backUrl' | 'backLabel'>,
): { run: TargetRun; joined: boolean } {
  const { limit, resultUrl, ...page } = opts;
  const claimed = claimRun(SCORE_RUN_KEY, { steps: ['score'], jobTitle: '', resumeName: '', ...page });
  if (claimed.joined) return claimed;
  const { run } = claimed;
  startRun(run.id, async () => {
    let stats: CronStats = {};
    await recordCronRun('score-unscored', async () => {
      const out = await runScoreUnscored({ limit, onProgress: (done, total) => updateRun(run.id, { progress: { done, total } }) });
      stats = out.stats;
      return out;
    });
    updateRun(run.id, { stage: 'done', resultUrl, flash: summarizeScoreRun(stats).text });
  });
  return claimed;
}

/** The jobs stored unscored, as the notice on Jobs and the Overview shows them; null when there are none. */
export async function loadUnscored(): Promise<UnscoredView | null> {
  // The rows runScoreUnscored reads: a muted company's are never scored.
  const count = await prisma.job.count({ where: { fitScore: null, status: JobStatus.NEW, ...withoutMuted(await mutedKeys()) } });
  if (count === 0) return null;
  return { count, cost: await spendHint('classifier'), runId: liveScoreRun()?.id ?? null };
}
