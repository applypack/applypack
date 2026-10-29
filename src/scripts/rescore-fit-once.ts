import { Prisma } from '@prisma/client';
import { logger } from '../logger';
import { prisma } from '../db';
import { rescoreFromFacts, type Rescored } from '../jobs/fit-rescore';
import { storedPlace } from '../jobs/classify-existing';
import { saveRescoredFits } from '../jobs/score-store';

/*
 * ADR 0064: make every stored fit again from the facts its rows keep, with
 * the weights in fit-score.ts and the searches as they are now. No AI call,
 * no HTTP: the facts were read once, and this only does the arithmetic.
 *
 * What it writes: each search's row (fit, tags, flags, priority rules) and the
 * Job's best-of columns through `score-store.ts:saveRescoredFits`. What it
 * never writes: a status. A posting that now clears a floor stays Dismissed and
 * one that now falls under every floor stays New — the run lists both, and
 * Save & re-classify is what moves them, by the rule an Applied, Saved or
 * hand-picked posting is exempt from. A row scored before v7 has no facts and
 * is counted, not touched.
 *
 * Usage: node dist/scripts/rescore-fit-once.js --dry-run   (read, print)
 *        node dist/scripts/rescore-fit-once.js             (write)
 *        … --only 413,515                                  (these jobs)
 */

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = onlyIds();

function onlyIds(): number[] | null {
  const i = process.argv.indexOf('--only');
  if (i === -1) return null;
  return (process.argv[i + 1] ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

function moved(r: Rescored): boolean {
  return r.rows.some((row) => row.before !== row.after);
}

async function main(): Promise<void> {
  const profiles = new Map((await prisma.profile.findMany()).map((p) => [p.id, p]));
  const jobs = await prisma.job.findMany({
    where: {
      ...(ONLY ? { id: { in: ONLY } } : {}),
      scores: { some: { fitFacts: { not: Prisma.DbNull } } },
    },
    include: { company: { select: { atsType: true } }, scores: true },
    orderBy: { id: 'asc' },
  });
  const withoutFacts = await prisma.job.count({
    where: { ...(ONLY ? { id: { in: ONLY } } : {}), fitScore: { not: null }, scores: { none: { fitFacts: { not: Prisma.DbNull } } } },
  });

  let changed = 0;
  let skipped = 0;
  const nowKept: string[] = [];
  const nowDismissed: string[] = [];
  for (const job of jobs) {
    const result = rescoreFromFacts(job, job.scores, profiles, storedPlace(job));
    if (!result) {
      skipped++;
      continue;
    }
    if (!moved(result) && result.merged.winner.classification.fit_score === job.fitScore) continue;
    changed++;
    const lines = result.rows
      .filter((row) => row.before !== row.after)
      .map((row) => {
        const name = profiles.get(row.profileId)?.name ?? `#${row.profileId}`;
        const floor = profiles.get(row.profileId)?.minFitScore;
        return `  ${name}: ${row.before} → ${row.after}${row.crossed ? ` (crossed ${row.crossed === 'up' ? 'up over' : 'down under'} ${floor})` : ''}`;
      });
    console.log(`#${job.id} ${job.status} "${job.title}"\n${lines.join('\n')}`);
    if (!result.keptBefore && result.keptNow) nowKept.push(`#${job.id} (${job.status})`);
    if (result.keptBefore && !result.keptNow) nowDismissed.push(`#${job.id} (${job.status})`);
    if (!DRY_RUN) await saveRescoredFits(job, result.merged, result.verdicts);
  }

  console.log(
    [
      '',
      `${jobs.length} postings with facts read; ${changed} ${DRY_RUN ? 'would change' : 'changed'}; ${skipped} skipped (a row without facts, or its search deleted).`,
      `${withoutFacts} scored postings have no facts (scored before v7): Re-classify brings them in.`,
      `Now wanted by a search, status unchanged: ${nowKept.length > 0 ? nowKept.join(', ') : 'none'}.`,
      `Now under every floor, status unchanged: ${nowDismissed.length > 0 ? nowDismissed.join(', ') : 'none'}.`,
      DRY_RUN ? 'Dry run: nothing was written.' : 'No status was changed; Save & re-classify moves them.',
    ].join('\n'),
  );
}

main()
  .catch((err) => {
    logger.error({ err }, 'rescore-fit: failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
