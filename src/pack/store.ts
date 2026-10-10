import type { ApplicationPack, Prisma } from '@prisma/client';
import { isUniqueViolation, prisma } from '../db';
import type { PrepareStep } from './gate';
import type { PackPosting, PackResume } from './prepare';
import { utcDayStart } from './trigger';
import type { PackNotice } from './view';

/*
 * The pack rows (ADR 0063) — the only file in the module that touches
 * Prisma for them. A row is the queue entry, the progress and the result in
 * one: `status` moves queued → running → ready | stopped | failed, and a row
 * the person marked as sent never changes again.
 */

/** A pack without its files — what every page and message works with. */
export type PackRow = Omit<ApplicationPack, 'docx' | 'pdf'>;

const WITHOUT_FILES = { docx: true, pdf: true } as const;

export type PackTrigger = 'auto' | 'manual';

export async function getPack(jobId: number): Promise<PackRow | null> {
  return prisma.applicationPack.findUnique({ where: { jobId }, omit: WITHOUT_FILES });
}

/** Which of the two files a pack holds, without reading them. */
export async function packFiles(jobId: number): Promise<{ docx: boolean; pdf: boolean }> {
  const [row] = await prisma.$queryRaw<{ docx: boolean; pdf: boolean }[]>`
    SELECT "docx" IS NOT NULL AS docx, "pdf" IS NOT NULL AS pdf FROM application_pack WHERE "jobId" = ${jobId}`;
  return row ?? { docx: false, pdf: false };
}

export async function getPackFile(jobId: number, kind: 'docx' | 'pdf'): Promise<{ bytes: Buffer; fileName: string } | null> {
  const row = await prisma.applicationPack.findUnique({ where: { jobId }, select: { docx: kind === 'docx', pdf: kind === 'pdf', fileName: true } });
  const bytes = kind === 'docx' ? row?.docx : row?.pdf;
  if (!row || !bytes) return null;
  const name = (row.fileName ?? 'Resume.docx').replace(/\.docx$/i, `.${kind}`);
  return { bytes: Buffer.from(bytes), fileName: name };
}

export type QueueOutcome = 'queued' | 'busy' | 'sent';

/**
 * Put a posting in the queue. A posting has one pack: asking again starts it
 * over, except while it is being prepared (`busy`) and once the person has
 * said its file went out (`sent`) — that row is the record of what they sent.
 * A row keeps the trigger it was born with, so preparing one again by hand
 * does not hand the day's limit a free slot.
 */
export async function queuePack(jobId: number, trigger: PackTrigger): Promise<QueueOutcome> {
  const existing = await prisma.applicationPack.findUnique({ where: { jobId }, select: { status: true, sentAt: true } });
  if (!existing) {
    try {
      await prisma.applicationPack.create({ data: { jobId, trigger } });
      return 'queued';
    } catch (err) {
      // Two presses at once: the other one queued it.
      if (isUniqueViolation(err)) return 'busy';
      throw err;
    }
  }
  if (existing.sentAt) return 'sent';
  if (existing.status === 'queued' || existing.status === 'running') return 'busy';
  const reset = await prisma.applicationPack.updateMany({
    where: { jobId, sentAt: null, status: { in: ['ready', 'stopped', 'failed'] } },
    data: { ...BLANK, status: 'queued', queuedAt: new Date() },
  });
  return reset.count > 0 ? 'queued' : 'busy';
}

/** Everything a run writes, cleared: a pack started over says nothing of the last attempt. */
const BLANK = {
  step: null,
  stop: null,
  why: null,
  resumeId: null,
  resumeName: null,
  matchId: null,
  tailoredMatchId: null,
  verificationId: null,
  coverLetterId: null,
  baseText: null,
  text: null,
  edits: {},
  scoreBefore: null,
  scoreAfter: null,
  docx: null,
  pdf: null,
  document: null,
  fileName: null,
  notifiedAt: null,
  startedAt: null,
  finishedAt: null,
} satisfies Prisma.ApplicationPackUpdateManyMutationInput;

/** Packs the worker queued on its own since the UTC day began — what the daily limit counts. */
export async function autoPacksToday(now: Date): Promise<number> {
  return prisma.applicationPack.count({ where: { trigger: 'auto', queuedAt: { gte: utcDayStart(now) } } });
}

/**
 * Whether the runner has a pack to take: one that waits, or one a worker that
 * stopped left `running`. The runner's lock tells the two kinds of `running`
 * apart — a beat that asked only for `queued` never started it, and such a
 * row said "Preparing" for ever.
 */
export async function hasUnfinishedPacks(): Promise<boolean> {
  return (await prisma.applicationPack.findFirst({ where: { status: { in: ['queued', 'running'] } }, select: { id: true } })) !== null;
}

/**
 * A row left `running` by a worker that stopped mid-pack goes back in the
 * queue. Only the runner calls this, under its lock, so no row it finds
 * running can belong to anyone still at work.
 */
export async function requeueOrphans(): Promise<number> {
  const { count } = await prisma.applicationPack.updateMany({ where: { status: 'running' }, data: { status: 'queued', step: null } });
  return count;
}

/** The oldest queued pack, taken: the update only lands while the row is still queued. */
export async function claimNextPack(): Promise<{ id: number; jobId: number; trigger: string } | null> {
  for (;;) {
    const next = await prisma.applicationPack.findFirst({ where: { status: 'queued' }, orderBy: { queuedAt: 'asc' }, select: { id: true, jobId: true, trigger: true } });
    if (!next) return null;
    const taken = await prisma.applicationPack.updateMany({ where: { id: next.id, status: 'queued' }, data: { status: 'running', startedAt: new Date() } });
    if (taken.count > 0) return next;
  }
}

export async function setPackStep(id: number, step: PrepareStep): Promise<void> {
  await prisma.applicationPack.updateMany({ where: { id, status: 'running' }, data: { step } });
}

/** A run's result, written once. `status: 'queued'` puts the row back (a worker stopping mid-pack). */
export async function finishPack(id: number, data: Prisma.ApplicationPackUpdateManyMutationInput): Promise<void> {
  await prisma.applicationPack.updateMany({ where: { id, status: 'running' }, data: { ...data, step: null, finishedAt: new Date() } });
}

/** The person says this file went out: the row is frozen from here. False when there is no ready pack to freeze. */
export async function markPackSent(jobId: number, at: Date): Promise<boolean> {
  const { count } = await prisma.applicationPack.updateMany({ where: { jobId, status: 'ready', sentAt: null }, data: { sentAt: at } });
  return count > 0;
}

const JOB_FOR_PACK = {
  company: { select: { name: true, atsType: true, atsToken: true } },
  // The search that scored it best is the one whose resume it would be sent with.
  scores: { orderBy: { fitScore: 'desc' }, take: 1, select: { profile: { select: { resumeId: true } } } },
} satisfies Prisma.JobInclude;

/** A posting as the orchestrator reads it, and the resume its best search hunts with (else the primary's). */
export async function loadPackInputs(jobId: number, primaryResumeId: number | null): Promise<{ posting: PackPosting; resume: PackResume | null } | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: JOB_FOR_PACK });
  if (!job) return null;
  const resumeId = job.scores[0]?.profile.resumeId ?? primaryResumeId;
  const resume =
    resumeId === null
      ? null
      : await prisma.resume.findFirst({ where: { id: resumeId, hidden: false }, select: { id: true, name: true, text: true, version: true, updatedAt: true } });
  return {
    posting: {
      id: job.id,
      title: job.title,
      // Who hires, not who lists (ADR 0056).
      companyName: job.employer ?? job.company.name,
      location: job.location,
      description: job.description,
      url: job.url,
      externalId: job.externalId,
      postedAt: job.postedAt,
      atsType: job.company.atsType,
      atsToken: job.company.atsToken,
    },
    resume,
  };
}

type NoticeRow = PackNotice & { id: number };

/** Finished packs the worker started on its own that no message has carried yet. */
export async function listUnnotifiedPacks(): Promise<NoticeRow[]> {
  const rows = await prisma.applicationPack.findMany({
    where: { trigger: 'auto', notifiedAt: null, status: { in: ['ready', 'stopped'] } },
    orderBy: { finishedAt: 'asc' },
    select: {
      id: true,
      status: true,
      stop: true,
      scoreBefore: true,
      scoreAfter: true,
      verificationId: true,
      job: { select: { title: true, employer: true, company: { select: { name: true } } } },
    },
  });
  const verdicts = await prisma.jobVerification.findMany({
    where: { id: { in: rows.flatMap((r) => r.verificationId ?? []) } },
    select: { id: true, verdict: true, recommendation: true },
  });
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  return rows.map((r) => {
    const checked = r.verificationId === null ? undefined : byId.get(r.verificationId);
    return {
      id: r.id,
      title: r.job.title,
      company: r.job.employer ?? r.job.company.name,
      status: r.status,
      stop: r.stop,
      scoreBefore: r.scoreBefore,
      scoreAfter: r.scoreAfter,
      verdict: checked?.verdict ?? null,
      recommendation: checked?.recommendation ?? null,
    };
  });
}

export async function markPacksNotified(ids: number[], at: Date): Promise<void> {
  if (ids.length > 0) await prisma.applicationPack.updateMany({ where: { id: { in: ids } }, data: { notifiedAt: at } });
}

export interface ReadyPack {
  jobId: number;
  title: string;
  company: string;
  scoreBefore: number | null;
  scoreAfter: number | null;
  finishedAt: Date | null;
}

/** Packs prepared and not yet sent, newest first — the Overview's "ready to send". */
export async function listReadyPacks(take: number): Promise<ReadyPack[]> {
  const rows = await prisma.applicationPack.findMany({
    where: { status: 'ready', sentAt: null, job: { status: { in: ['NEW', 'ALERTED', 'SAVED'] } } },
    orderBy: { finishedAt: 'desc' },
    take,
    select: { jobId: true, scoreBefore: true, scoreAfter: true, finishedAt: true, job: { select: { title: true, employer: true, company: { select: { name: true } } } } },
  });
  return rows.map((r) => ({
    jobId: r.jobId,
    title: r.job.title,
    company: r.job.employer ?? r.job.company.name,
    scoreBefore: r.scoreBefore,
    scoreAfter: r.scoreAfter,
    finishedAt: r.finishedAt,
  }));
}
