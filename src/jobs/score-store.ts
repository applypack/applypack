import { AtsType, JobStatus, Prisma, type Job } from '@prisma/client';
import { prisma } from '../db';
import { withApplyLinkFlags } from '../apply-link';
import type { MergedVerdict, ProfileVerdict } from './verdict-merge';
import type { StoredPlace } from './location-merge';

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
    // ADR 0064: the facts this fit was computed from, so it can be computed again without a call.
    ...(v.classification.fit_facts && { fitFacts: v.classification.fit_facts }),
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
  /** The posting's place after the model's block was merged in (ADR 0032); omitted = untouched. */
  place?: StoredPlace,
): Promise<void> {
  const c = merged.winner.classification;
  const link = { url: job.url, pasted: job.company.atsType === AtsType.MANUAL };
  await prisma.$transaction([
    prisma.jobScore.deleteMany({ where: { jobId: job.id } }),
    prisma.job.update({
      where: { id: job.id },
      data: {
        ...(place && {
          workplace: place.workplace,
          countries: place.countries,
          regions: place.regions,
          locationSource: place.source,
        }),
        fitScore: c.fit_score,
        salaryMin: c.salary_min,
        salaryMax: c.salary_max,
        salaryCurrency: c.salary_currency,
        salaryPeriod: c.salary_period,
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

/**
 * A re-score from stored facts (rescore-fit-once.ts): each search's row takes
 * its new number, tags and flags in place, and the Job the winner's, with the
 * winner's own summary. Nothing else moves — not the status, not the place or
 * the pay, not `scoredAt`: no model read the posting again.
 */
export async function saveRescoredFits(
  job: Pick<Job, 'id' | 'url'> & { company: { atsType: AtsType } },
  merged: MergedVerdict,
  verdicts: ProfileVerdict[],
): Promise<void> {
  const c = merged.winner.classification;
  const link = { url: job.url, pasted: job.company.atsType === AtsType.MANUAL };
  await prisma.$transaction([
    ...verdicts.map((v) =>
      prisma.jobScore.update({
        where: { jobId_profileId: { jobId: job.id, profileId: v.profileId } },
        data: {
          fitScore: v.classification.fit_score,
          techMatch: v.classification.tech_match,
          redFlags: withApplyLinkFlags(v.classification.red_flags, link),
          priorityRulesApplied: v.priorityRulesApplied,
        },
      }),
    ),
    prisma.job.update({
      where: { id: job.id },
      data: {
        fitScore: c.fit_score,
        techMatch: c.tech_match,
        redFlags: withApplyLinkFlags(c.red_flags, link),
        summary: c.summary,
        priorityRulesApplied: merged.winner.priorityRulesApplied,
      },
    }),
  ]);
}
