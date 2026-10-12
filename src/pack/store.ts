import type { ApplicationPack, Prisma } from '@prisma/client';
import { isUniqueViolation, prisma } from '../db';
import { companyForMessage, companyForPrompt } from '../employer';
import { preselectResume } from '../resume/pick';
import type { PrepareStep } from './gate';
import type { PackPosting, PackResume } from './prepare';
import { utcDayStart, type SameRole } from './trigger';
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

/** `waiting`: already in the queue; `busy`: the runner has it. Both mean nothing was queued by this press. */
export type QueueOutcome = 'queued' | 'waiting' | 'busy' | 'sent' | 'kept';

/** A posting the person applied to, by any road: marked applied, or put on the applications board. */
const APPLIED_TO = { OR: [{ status: 'APPLIED' }, { appliedAt: { not: null } }, { pipelineStage: { not: null } }] } satisfies Prisma.JobWhereInput;

/**
 * Whether a job's ready pack is kept as it is: the person applied, and its
 * file may be the one that went out whether or not they said so. Starting
 * it over would delete that file.
 */
export async function packIsKept(jobId: number): Promise<boolean> {
  return (await prisma.applicationPack.count({ where: { jobId, status: 'ready', job: APPLIED_TO } })) > 0;
}

/**
 * Put a posting in the queue. A posting has one pack: asking again starts it
 * over, except while it is being prepared (`busy`), once the person has said
 * its file went out (`sent`) — that row is the record of what they sent — and
 * while a ready pack belongs to a job they applied to (`kept`). A pack
 * started over belongs to whoever asked this time (#382): the trigger says
 * who asked for the preparing the row holds, not who asked for the first
 * one. So a pack the tick queued and the person prepared again is theirs —
 * it takes no slot of the day's limit, no message announces it, and neither
 * the switch nor what became of the job takes it out of the queue.
 */
export async function queuePack(jobId: number, trigger: PackTrigger): Promise<QueueOutcome> {
  const existing = await prisma.applicationPack.findUnique({ where: { jobId }, select: { status: true, sentAt: true } });
  if (!existing) {
    try {
      await prisma.applicationPack.create({ data: { jobId, trigger } });
      return 'queued';
    } catch (err) {
      // Two presses at once: the other one queued it.
      if (isUniqueViolation(err)) return 'waiting';
      throw err;
    }
  }
  if (existing.sentAt) return 'sent';
  if (existing.status === 'queued') return 'waiting';
  if (existing.status === 'running') return 'busy';
  if (await packIsKept(jobId)) return 'kept';
  const reset = await prisma.applicationPack.updateMany({
    where: { jobId, sentAt: null, status: { in: ['ready', 'stopped', 'failed'] } },
    data: { ...BLANK, trigger, status: 'queued', queuedAt: new Date() },
  });
  // No row reset: another press started it over meanwhile, so it is in the queue.
  return reset.count > 0 ? 'queued' : 'waiting';
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

/** How far a chain of copies is followed up: a copy of a copy of a copy is already rare. */
const COPY_HOPS = 5;

/**
 * The other stored postings of the role a job is a copy of: the posting it
 * was linked to (`crossListedOfJobId`, ADR 0018), what that one was linked
 * to, and the copies linked to it or to any of them. Empty for a posting
 * no other source carries.
 */
async function sameRoleJobs(jobId: number): Promise<{ id: number; fetchedAt: Date; employerKey: string | null }[]> {
  const select = { id: true, fetchedAt: true, employerKey: true, crossListedOfJobId: true } as const;
  const self = await prisma.job.findUnique({ where: { id: jobId }, select: { crossListedOfJobId: true } });
  const above: { id: number; fetchedAt: Date; employerKey: string | null }[] = [];
  let next = self?.crossListedOfJobId ?? null;
  for (let hop = 0; next !== null && hop < COPY_HOPS; hop++) {
    const row = await prisma.job.findUnique({ where: { id: next }, select });
    if (!row || row.id === jobId || above.some((a) => a.id === row.id)) break;
    above.push(row);
    next = row.crossListedOfJobId;
  }
  const known = [jobId, ...above.map((a) => a.id)];
  const beside = await prisma.job.findMany({ where: { crossListedOfJobId: { in: known }, id: { notIn: known } }, select });
  return [...above, ...beside];
}

/** The posting of the same role that holds a pack — where the tab of one that holds none points (#380). */
export async function packOfSameRole(jobId: number): Promise<number | null> {
  const jobs = await sameRoleJobs(jobId);
  if (jobs.length === 0) return null;
  const pack = await prisma.applicationPack.findFirst({ where: { jobId: { in: jobs.map((j) => j.id) } }, orderBy: { queuedAt: 'desc' }, select: { jobId: true } });
  return pack?.jobId ?? null;
}

/** What the tick asks before it queues a pack for a copy (trigger.ts:copyPack); null for a posting no other source carries. */
export async function sameRole(jobId: number): Promise<SameRole | null> {
  const jobs = await sameRoleJobs(jobId);
  if (jobs.length === 0) return null;
  const packs = await prisma.applicationPack.count({ where: { jobId: { in: jobs.map((j) => j.id) } } });
  return { hasPack: packs > 0, firstStoredAt: new Date(Math.min(...jobs.map((j) => j.fetchedAt.getTime()))) };
}

/** Packs the worker queued on its own since the UTC day began — what the daily limit counts. */
export async function autoPacksToday(now: Date): Promise<number> {
  // A pack that failed before it compared anything (no resume to read, the engine down) spent nothing, and takes no slot.
  return prisma.applicationPack.count({ where: { trigger: 'auto', queuedAt: { gte: utcDayStart(now) }, NOT: { status: 'failed', matchId: null } } });
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

/**
 * The next queued pack, taken: one the person asked for before the ones the
 * tick queued, the oldest first among each. Somebody is waiting on the page
 * for a pack asked for by hand, and behind five automatic ones it waited a
 * quarter of an hour under "the worker starts it within a minute" (#384).
 * The update only lands while the row is still queued.
 */
export async function claimNextPack(): Promise<{ id: number; jobId: number; trigger: string } | null> {
  const oldest = (trigger?: PackTrigger) =>
    prisma.applicationPack.findFirst({ where: { status: 'queued', trigger }, orderBy: { queuedAt: 'asc' }, select: { id: true, jobId: true, trigger: true } });
  for (;;) {
    const next = (await oldest('manual')) ?? (await oldest());
    if (!next) return null;
    const taken = await prisma.applicationPack.updateMany({ where: { id: next.id, status: 'queued' }, data: { status: 'running', startedAt: new Date() } });
    if (taken.count > 0) return next;
  }
}

/** What became of a job since its pack was queued: its status, whether it was applied to by any road, and who hires. */
export async function packJobState(jobId: number): Promise<{ status: string; applied: boolean; employerKey: string | null } | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true, appliedAt: true, pipelineStage: true, employerKey: true } });
  return job && { status: job.status, applied: job.status === 'APPLIED' || job.appliedAt !== null || job.pipelineStage !== null, employerKey: job.employerKey };
}

/**
 * A pack the tick queued and nobody wants any more, taken out before
 * anything is prepared: no row is left to announce, and the day's limit gets
 * its slot back. Never a pack asked for by hand.
 */
export async function dropAutoPack(id: number): Promise<void> {
  await prisma.applicationPack.deleteMany({ where: { id, trigger: 'auto', status: 'running' } });
}

/**
 * A pack still waiting in the queue, taken out by the person: nothing was
 * prepared and nothing is spent. False once the runner has it, or it is done —
 * the delete only lands on a row that is still queued.
 */
export async function cancelQueuedPack(jobId: number): Promise<boolean> {
  return (await prisma.applicationPack.deleteMany({ where: { jobId, status: 'queued' } })).count > 0;
}

/** Packs were switched off: the ones the tick queued and no runner has started are not prepared. Returns how many. */
export async function cancelQueuedAutoPacks(): Promise<number> {
  return (await prisma.applicationPack.deleteMany({ where: { trigger: 'auto', status: 'queued' } })).count;
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

/**
 * A posting as the orchestrator reads it, and the resume it is prepared with:
 * the one its best search hunts with (else the primary's), and for a search
 * that names none the one whose skills the posting asks for most — what the
 * job page preselects (resume/pick.ts), since "Resume for this search" is
 * optional. Null only when no resume is stored.
 */
export async function loadPackInputs(jobId: number, primaryResumeId: number | null): Promise<{ posting: PackPosting; resume: PackResume | null } | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: JOB_FOR_PACK });
  if (!job) return null;
  const stored = await prisma.resume.findMany({ where: { hidden: false }, select: { id: true, skills: true, isDefault: true } });
  const picked = preselectResume(stored, `${job.title} ${job.description}`, job.scores[0]?.profile.resumeId ?? primaryResumeId);
  const resume = picked && (await prisma.resume.findUnique({ where: { id: picked.id }, select: { id: true, name: true, text: true, version: true, updatedAt: true } }));
  // The same role at the same hiring company: a copy an agency lists under its own name is another company to check.
  const sameCompany = job.employerKey === null ? [] : (await sameRoleJobs(job.id)).filter((j) => j.employerKey === job.employerKey);
  return {
    posting: {
      id: job.id,
      title: job.title,
      // Who hires, not who lists (ADR 0056) — and nobody, when the row named none.
      companyName: companyForPrompt(job.employer, job.company),
      location: job.location,
      description: job.description,
      url: job.url,
      externalId: job.externalId,
      postedAt: job.postedAt,
      atsType: job.company.atsType,
      atsToken: job.company.atsToken,
      sameRole: sameCompany.map((j) => j.id),
    },
    resume,
  };
}

type NoticeRow = PackNotice & { id: number };

/** Finished packs the worker started on its own that no message has carried yet — the ones that failed too: a pack that came to nothing is not passed over in silence. */
export async function listUnnotifiedPacks(): Promise<NoticeRow[]> {
  const rows = await prisma.applicationPack.findMany({
    where: { trigger: 'auto', notifiedAt: null, status: { in: ['ready', 'stopped', 'failed'] } },
    orderBy: { finishedAt: 'asc' },
    select: {
      id: true,
      status: true,
      stop: true,
      scoreBefore: true,
      scoreAfter: true,
      verificationId: true,
      job: { select: { title: true, employer: true, company: { select: { name: true, atsType: true } } } },
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
      company: companyForMessage(r.job.employer, r.job.company),
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
/**
 * A pack worth opening to send: ready, not sent, its job still undecided —
 * and its posting not found closed since (#384). `liveness` is NULL until a
 * check runs, and NULL is not "expired".
 */
const READY_TO_SEND = {
  status: 'ready',
  sentAt: null,
  job: { status: { in: ['NEW', 'ALERTED', 'SAVED'] }, OR: [{ liveness: null }, { liveness: { not: 'expired' } }] },
} satisfies Prisma.ApplicationPackWhereInput;

/** How many packs are ready to send: the card lists the newest few and says how many there are. */
export function countReadyPacks(): Promise<number> {
  return prisma.applicationPack.count({ where: READY_TO_SEND });
}

export async function listReadyPacks(take: number): Promise<ReadyPack[]> {
  const rows = await prisma.applicationPack.findMany({
    where: READY_TO_SEND,
    orderBy: { finishedAt: 'desc' },
    take,
    select: { jobId: true, scoreBefore: true, scoreAfter: true, finishedAt: true, job: { select: { title: true, employer: true, company: { select: { name: true, atsType: true } } } } },
  });
  return rows.map((r) => ({
    jobId: r.jobId,
    title: r.job.title,
    company: companyForMessage(r.job.employer, r.job.company),
    scoreBefore: r.scoreBefore,
    scoreAfter: r.scoreAfter,
    finishedAt: r.finishedAt,
  }));
}
