import type { Applicant, Prisma, Screening, ScreeningVerdict } from '@prisma/client';
import { prisma } from '../db';
import { readRubric, type Rubric } from './rubric';
import { toDbBigInt } from '../fingerprint';
import type { KnownApplicant } from './intake';

/*
 * The only file in src/screening/ that touches Prisma (the resume module's
 * rule, ADR 0008). Applicants and verdicts are scoped to one screening and
 * cascade with it; nothing here reads a Resume row and nothing in
 * src/resume/ reads these (hr-screening-plan.md §1, "a trap in the existing
 * tables").
 */

export type ApplicantSummary = Omit<Applicant, 'original'>;
export type ApplicantWithVerdict = ApplicantSummary & {
  /** The latest verdict, whatever rubric version it was scored under. */
  verdict: ScreeningVerdict | null;
  /** True when the latest verdict predates the current rubric. */
  stale: boolean;
};
export type ScreeningWithJob = Screening & {
  job: { id: number; title: string; location: string; description: string; company: { name: string } };
};

export interface ScreeningSummary {
  id: number;
  title: string;
  jobId: number;
  jobTitle: string;
  companyName: string;
  rubricVersion: number;
  retainUntil: Date;
  createdAt: Date;
  applicants: number;
  /** Applicants with a verdict under the current rubric. */
  scored: number;
  /** Files that could not be read or were a copy of another applicant. */
  unread: number;
}

export async function listScreenings(): Promise<ScreeningSummary[]> {
  const rows = await prisma.screening.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      job: { select: { title: true, company: { select: { name: true } } } },
      applicants: {
        select: { parseStatus: true, verdicts: { select: { rubricVersion: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      },
    },
  });
  return rows.map((s) => ({
    id: s.id,
    title: s.title,
    jobId: s.jobId,
    jobTitle: s.job.title,
    companyName: s.job.company.name,
    rubricVersion: s.rubricVersion,
    retainUntil: s.retainUntil,
    createdAt: s.createdAt,
    applicants: s.applicants.length,
    scored: s.applicants.filter((a) => a.verdicts[0]?.rubricVersion === s.rubricVersion).length,
    unread: s.applicants.filter((a) => a.parseStatus !== 'ok').length,
  }));
}

export async function createScreening(input: { jobId: number; title: string; rubric: Rubric; retainUntil: Date }): Promise<Screening> {
  return prisma.screening.create({
    data: { jobId: input.jobId, title: input.title, rubric: input.rubric as Prisma.InputJsonValue, retainUntil: input.retainUntil },
  });
}

export async function getScreening(id: number): Promise<ScreeningWithJob | null> {
  return prisma.screening.findUnique({
    where: { id },
    include: { job: { select: { id: true, title: true, location: true, description: true, company: { select: { name: true } } } } },
  });
}

/** Writes the rubric; `bump` when the yardstick changed, so every stored verdict reads as stale. */
export async function saveRubric(id: number, rubric: Rubric, bump: boolean): Promise<Screening> {
  return prisma.screening.update({
    where: { id },
    data: { rubric: rubric as Prisma.InputJsonValue, ...(bump ? { rubricVersion: { increment: 1 } } : {}) },
  });
}

export async function deleteScreening(id: number): Promise<void> {
  await prisma.screening.delete({ where: { id } });
}

export async function extendRetention(id: number, retainUntil: Date): Promise<void> {
  await prisma.screening.update({ where: { id }, data: { retainUntil } });
}

export function rubricOf(screening: Pick<Screening, 'rubric'>): Rubric {
  return readRubric(screening.rubric);
}

export async function listKnownApplicants(screeningId: number): Promise<KnownApplicant[]> {
  const rows = await prisma.applicant.findMany({
    where: { screeningId, parseStatus: { not: 'duplicate' } },
    select: { id: true, number: true, email: true, textHash: true, simhash: true },
  });
  return rows.map((r) => ({ id: r.id, number: r.number, email: r.email, hash: r.textHash, simhash: r.simhash }));
}

export async function countApplicants(screeningId: number): Promise<number> {
  return prisma.applicant.count({ where: { screeningId } });
}

export interface NewApplicant {
  screeningId: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  sourceFilename: string;
  mimeType: string;
  original: Buffer;
  text: string;
  /** The redacted text for the number the store assigns — the "Applicant №N" label has to carry the real one. */
  redactedTextFor: (number: number) => string;
  redactions: { kind: string; count: number }[];
  parseStatus: 'ok' | 'unreadable' | 'duplicate';
  parseNote: string | null;
  duplicateOfId: number | null;
  textHash: string;
  simhash: bigint | null;
}

/** Numbers are handed out in one transaction per row, so two uploads never share a №. */
export async function createApplicant(input: NewApplicant): Promise<ApplicantSummary> {
  return prisma.$transaction(async (tx) => {
    const last = await tx.applicant.aggregate({ where: { screeningId: input.screeningId }, _max: { number: true } });
    const number = (last._max.number ?? 0) + 1;
    const { redactedTextFor, ...fields } = input;
    const row = await tx.applicant.create({
      data: {
        ...fields,
        // Prisma 6 types Bytes as Uint8Array<ArrayBuffer>; a Buffer's backing store may be shared.
        original: new Uint8Array(input.original),
        redactedText: redactedTextFor(number),
        redactions: input.redactions as Prisma.InputJsonValue,
        simhash: toDbBigInt(input.simhash),
        number,
      },
    });
    const { original: _original, ...summary } = row;
    return summary;
  });
}

export async function listApplicants(screeningId: number, rubricVersion: number): Promise<ApplicantWithVerdict[]> {
  const rows = await prisma.applicant.findMany({
    where: { screeningId },
    orderBy: { number: 'asc' },
    omit: { original: true },
    include: { verdicts: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  return rows.map(({ verdicts, ...a }) => {
    const verdict = verdicts[0] ?? null;
    return { ...a, verdict, stale: verdict !== null && verdict.rubricVersion !== rubricVersion };
  });
}

export async function getApplicant(id: number): Promise<(ApplicantWithVerdict & { screening: ScreeningWithJob }) | null> {
  const row = await prisma.applicant.findUnique({
    where: { id },
    omit: { original: true },
    include: {
      verdicts: { orderBy: { createdAt: 'desc' }, take: 1 },
      screening: {
        include: { job: { select: { id: true, title: true, location: true, description: true, company: { select: { name: true } } } } },
      },
    },
  });
  if (!row) return null;
  const { verdicts, ...a } = row;
  const verdict = verdicts[0] ?? null;
  return { ...a, verdict, stale: verdict !== null && verdict.rubricVersion !== row.screening.rubricVersion };
}

export async function getApplicantFile(id: number): Promise<{ original: Buffer; sourceFilename: string; mimeType: string } | null> {
  const row = await prisma.applicant.findUnique({ where: { id }, select: { original: true, sourceFilename: true, mimeType: true } });
  return row ? { original: Buffer.from(row.original), sourceFilename: row.sourceFilename, mimeType: row.mimeType } : null;
}

export async function deleteApplicant(id: number): Promise<void> {
  await prisma.applicant.delete({ where: { id } });
}

export const DECISIONS = ['interview', 'hold', 'declined'] as const;
export type Decision = (typeof DECISIONS)[number];

/** The person's decision — the one write the tool never makes on its own (ADR 0047). */
export async function setDecision(id: number, decision: Decision | null): Promise<void> {
  await prisma.applicant.update({ where: { id }, data: { decision, decidedAt: decision ? new Date() : null } });
}

/** Readable applicants with no verdict under this rubric version — what a run (or a resumed run) scores. */
export async function listPending(screeningId: number, rubricVersion: number): Promise<Pick<Applicant, 'id' | 'number' | 'redactedText'>[]> {
  return prisma.applicant.findMany({
    where: { screeningId, parseStatus: 'ok', verdicts: { none: { rubricVersion } } },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, redactedText: true },
  });
}

export async function createVerdict(input: {
  applicantId: number;
  rubricVersion: number;
  promptVersion: number;
  model: string;
  facts: unknown;
  breakdown: unknown;
  score: number;
  confidence: string;
  gateBucket: string;
}): Promise<ScreeningVerdict> {
  return prisma.screeningVerdict.create({
    data: { ...input, facts: input.facts as Prisma.InputJsonValue, breakdown: input.breakdown as Prisma.InputJsonValue },
  });
}

/** The cleanup cron's one call (ADR 0048): screenings past their date go with every file and verdict. */
export async function deleteExpiredScreenings(now: Date): Promise<number> {
  const r = await prisma.screening.deleteMany({ where: { retainUntil: { lt: now } } });
  return r.count;
}
