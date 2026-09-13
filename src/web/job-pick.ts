import type { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { getActiveProfile } from '../profiles';

/*
 * The jobs a candidate-side launcher (/target, /letter) offers in its picker:
 * newest first among the ones that clear the primary search's threshold — a
 * resume is compared and a letter written for something you would actually
 * apply to. The picker is searchable, so a long list costs nothing.
 */

const JOB_PICK_LIMIT = 150;
const PICKABLE: JobStatus[] = ['NEW', 'ALERTED', 'SAVED', 'APPLIED'];
const DAY_MS = 86_400_000;

/** A picker option, not a posting: five columns instead of the row's forty (DATA-5). */
const PICK_SELECT = { id: true, title: true, fitScore: true, fetchedAt: true, company: { select: { name: true } } } as const;

export interface JobPickOption {
  id: number;
  title: string;
  companyName: string;
  /** Between the title and the age: "fit 72", "pasted". */
  note: string | null;
  ageDays: number;
}

type PickRow = { id: number; title: string; fetchedAt: Date; company: { name: string } };

/** One stored job as a picker line. */
export function toPickOption(job: PickRow, note: string | null, now = Date.now()): JobPickOption {
  return {
    id: job.id,
    title: job.title,
    companyName: job.company.name,
    note,
    ageDays: Math.max(0, Math.floor((now - job.fetchedAt.getTime()) / DAY_MS)),
  };
}

/**
 * `include` is a job the page was opened for (`/target?job=70`): it is listed
 * first when the threshold or the limit left it out, because a link that
 * lands on a picker without its job reads as "that job is gone".
 */
export async function listPickableJobs(include: number | null = null): Promise<JobPickOption[]> {
  const profile = await getActiveProfile();
  const fitting = await prisma.job.findMany({
    where: { status: { in: PICKABLE }, ...(profile ? { fitScore: { gte: profile.minFitScore } } : {}) },
    orderBy: [{ fetchedAt: 'desc' }],
    take: JOB_PICK_LIMIT,
    select: PICK_SELECT,
  });
  // A brand-new install (or a strict threshold) can filter everything out;
  // an empty picker would read as "you have no jobs", which is a lie.
  const jobs =
    fitting.length > 0
      ? fitting
      : await prisma.job.findMany({
          where: { status: { in: PICKABLE } },
          orderBy: [{ fetchedAt: 'desc' }],
          take: JOB_PICK_LIMIT,
          select: PICK_SELECT,
        });
  if (include !== null && !jobs.some((j) => j.id === include)) {
    const extra = await prisma.job.findUnique({ where: { id: include }, select: PICK_SELECT });
    if (extra) jobs.unshift(extra);
  }
  const now = Date.now();
  return jobs.map((j) => toPickOption(j, j.fitScore !== null ? `fit ${j.fitScore}` : null, now));
}
