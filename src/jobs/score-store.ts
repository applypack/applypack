import { AtsType, JobStatus, Prisma, type Job } from '@prisma/client';
import { prisma } from '../db';
import { withApplyLinkFlags } from '../apply-link';
import type { MergedVerdict, ProfileVerdict } from './verdict-merge';

/*
 * The one place a re-score is written (ADR 0028). New postings take the nested
 * create in process-jobs; everything that re-scores a row that already exists —
 * "Re-classify all", the per-job button, a pasted job — comes through here, so
 * the best-of on Job and the per-search rows can never drift apart.
 */

/** Where the posting can be applied — the same context `Job.redFlags` gets. */
export interface ApplyLinkContext {
  url: string;
  pasted: boolean;
}

/**
 * One search's verdict, as the row that keeps it. The apply-link flags are a
 * property of the posting rather than of a search, so every row carries them:
 * CLAUDE.md's invariant is that `withApplyLinkFlags` runs at every site that
 * persists `redFlags` (ADR 0023), and this is one.
 */
export function toScoreData(
  v: ProfileVerdict,
  link: ApplyLinkContext,
): Prisma.JobScoreCreateWithoutJobInput {
  return {
    profile: { connect: { id: v.profileId } },
    fitScore: v.classification.fit_score,
    locationMatch: v.classification.location_match,
    techMatch: v.classification.tech_match,
    redFlags: withApplyLinkFlags(v.classification.red_flags, link),
    summary: v.classification.summary,
    priorityRulesApplied: v.priorityRulesApplied,
  };
}

/**
 * Write the winning search's numbers onto the Job row and replace that job's
 * per-search rows in one transaction.
 *
 * The rows are deleted and re-created rather than upserted: a search that has
 * since been switched off must lose its verdict, or the job page would show a
 * score from a hunt that is no longer running. Only the searches in `verdicts`
 * survive, which is exactly the roster that produced this reply.
 */
export async function saveJobScores(
  job: Pick<Job, 'id' | 'url'> & { company: { atsType: AtsType } },
  merged: MergedVerdict,
  verdicts: ProfileVerdict[],
  status: JobStatus,
): Promise<void> {
  const c = merged.winner.classification;
  const link = { url: job.url, pasted: job.company.atsType === AtsType.MANUAL };
  await prisma.$transaction([
    prisma.jobScore.deleteMany({ where: { jobId: job.id } }),
    prisma.job.update({
      where: { id: job.id },
      data: {
        fitScore: c.fit_score,
        salaryMin: c.salary_min_usd,
        salaryMax: c.salary_max_usd,
        techMatch: c.tech_match,
        redFlags: withApplyLinkFlags(c.red_flags, link),
        summary: c.summary,
        status,
        priorityRulesApplied: merged.winner.priorityRulesApplied,
        scores: { create: verdicts.map((v) => toScoreData(v, link)) },
      },
    }),
  ]);
}
