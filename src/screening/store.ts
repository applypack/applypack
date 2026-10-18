import type { Applicant, Prisma, Screening, ScreeningComparison, ScreeningVerdict } from '@prisma/client';
import { prisma } from '../db';
import { companyForPrompt } from '../employer';
import { readRubric, type Rubric } from './rubric';
import { toDbBigInt } from '../fingerprint';
import type { KnownApplicant, SameAs } from './intake';

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
  job: { id: number; title: string; employer: string | null; location: string; company: { name: string; atsType: string } };
};

/**
 * The posting as a screening's calls read it — its own snapshot, never the
 * Job's live text (plan §4) — with who hires as a prompt states it: a row
 * that names no company has none, not its folder's or its feed's name (#444).
 */
export function postingOf(screening: ScreeningWithJob): { id: number; title: string; companyName: string; location: string; description: string } {
  return {
    id: screening.job.id,
    title: screening.job.title,
    companyName: companyForPrompt(screening.job.employer, screening.job.company),
    location: screening.job.location,
    description: screening.postingText,
  };
}

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
  /** Files that could not be read, or held for a look before any model reads them (TASKS E4). */
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

export async function createScreening(input: { jobId: number; title: string; postingText: string; rubric: Rubric; retainUntil: Date }): Promise<Screening> {
  return prisma.screening.create({
    data: {
      jobId: input.jobId,
      title: input.title,
      postingText: input.postingText,
      rubric: input.rubric as Prisma.InputJsonValue,
      retainUntil: input.retainUntil,
    },
  });
}

/** The person's edit to the posting — stamped, so older verdicts read as scored against other text. */
export async function savePosting(id: number, postingText: string): Promise<void> {
  await prisma.screening.update({ where: { id }, data: { postingText, postingUpdatedAt: new Date() } });
}

export async function getScreening(id: number): Promise<ScreeningWithJob | null> {
  return prisma.screening.findUnique({
    where: { id },
    include: { job: { select: { id: true, title: true, employer: true, location: true, company: { select: { name: true, atsType: true } } } } },
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
    where: { screeningId, parseStatus: 'ok' },
    select: { id: true, number: true, email: true, phone: true, textHash: true, simhash: true },
  });
  return rows.map((r) => ({ id: r.id, number: r.number, email: r.email, phone: r.phone, hash: r.textHash, simhash: r.simhash }));
}

export async function countApplicants(screeningId: number): Promise<number> {
  return prisma.applicant.count({ where: { screeningId } });
}

export interface NewApplicant {
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
  /** `held`: the leak check found something identifying after redaction — no model reads it until a person releases it (TASKS E4). */
  parseStatus: 'ok' | 'unreadable' | 'held';
  parseNote: string | null;
  /** Another document of an applicant already stored, or of one earlier in `inputs` (`intake.ts:planIntake`). */
  sameAs: SameAs;
  textHash: string;
  simhash: bigint | null;
}

/** Rows per INSERT: an upload's 200 MB of files is not one statement. */
const INSERT_CHUNK = 20;
/** Three hundred files' bytes go in inside it. */
const INTAKE_TX_TIMEOUT_MS = 120_000;

/**
 * One upload's applicants in one transaction (TASKS H23/H25): the screening
 * locked once — two uploads at once would read the same max, and the lock
 * serialises them, so a № is handed out exactly once — numbers in upload
 * order, a `sameAs` to a file earlier in the same upload resolved once its
 * row exists. A file whose text or bytes are already stored — by another
 * upload since the plan was made, or earlier in this one (two copies of one
 * unreadable scan) — is `skipped`: the unique key of ADR 0053 would refuse it.
 */
export async function createApplicants(
  screeningId: number,
  inputs: NewApplicant[],
): Promise<{ created: (ApplicantSummary & { input: number })[]; skipped: number }> {
  if (inputs.length === 0) return { created: [], skipped: 0 };
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT id FROM screening WHERE id = ${screeningId} FOR UPDATE`;
      const taken = new Set(
        (await tx.applicant.findMany({ where: { screeningId, textHash: { in: inputs.map((i) => i.textHash) } }, select: { textHash: true } })).map(
          (r) => r.textHash,
        ),
      );
      const last = await tx.applicant.aggregate({ where: { screeningId }, _max: { number: true } });
      let next = last._max.number ?? 0;
      // The plan compares texts; two copies of one unreadable file share a byte hash, and the unique key would refuse the second.
      const rows = inputs.flatMap((input, index) => {
        if (taken.has(input.textHash)) return [];
        taken.add(input.textHash);
        return [{ input, index, number: ++next }];
      });
      const created: (ApplicantSummary & { input: number })[] = [];
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK);
        const out = await tx.applicant.createManyAndReturn({
          data: chunk.map(({ input, number }) => {
            const { redactedTextFor, sameAs, ...fields } = input;
            return {
              ...fields,
              screeningId,
              // Prisma 6 types Bytes as Uint8Array<ArrayBuffer>; a Buffer's backing store may be shared.
              original: new Uint8Array(input.original),
              redactedText: redactedTextFor(number),
              redactions: input.redactions as Prisma.InputJsonValue,
              simhash: toDbBigInt(input.simhash),
              sameAsId: sameAs !== null && 'id' in sameAs ? sameAs.id : null,
              number,
            };
          }),
          omit: { original: true },
        });
        // RETURNING has no promised order; the number is unique within the screening.
        const indexOf = new Map(chunk.map((r) => [r.number, r.index]));
        created.push(...out.map((row) => ({ ...row, input: indexOf.get(row.number)! })));
      }
      // A second document of someone earlier in this upload points at a row that exists now.
      const idOf = new Map(created.map((row) => [row.input, row.id]));
      for (const row of created) {
        const sameAs = inputs[row.input]!.sameAs;
        if (sameAs === null || !('add' in sameAs)) continue;
        const target = idOf.get(sameAs.add);
        if (target === undefined) continue;
        await tx.applicant.update({ where: { id: row.id }, data: { sameAsId: target } });
        row.sameAsId = target;
      }
      return { created: created.sort((a, b) => a.number - b.number), skipped: inputs.length - rows.length };
    },
    { timeout: INTAKE_TX_TIMEOUT_MS },
  );
}

/** A table row: everything but the file and the two texts — three hundred applicants twice over is what the page used to load (DATA-5). */
export type ApplicantRow = Omit<ApplicantWithVerdict, 'text' | 'redactedText'> & {
  /** Cover letters attached to this applicant (TASKS E3). */
  letters: number;
};

export async function listApplicants(screeningId: number, rubricVersion: number): Promise<ApplicantRow[]> {
  const rows = await prisma.applicant.findMany({
    where: { screeningId },
    orderBy: { number: 'asc' },
    omit: { original: true, text: true, redactedText: true },
    include: { verdicts: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { letters: true } } },
  });
  return rows.map(({ verdicts, _count, ...a }) => {
    const verdict = verdicts[0] ?? null;
    return { ...a, letters: _count.letters, verdict, stale: verdict !== null && verdict.rubricVersion !== rubricVersion };
  });
}

/** The shortlist with its redacted texts — what a comparison reads; never for the table. */
export async function listApplicantsWithText(screeningId: number, rubricVersion: number, ids?: number[]): Promise<ApplicantWithVerdict[]> {
  const rows = await prisma.applicant.findMany({
    where: { screeningId, ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { number: 'asc' },
    omit: { original: true },
    include: { verdicts: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  return rows.map(({ verdicts, ...a }) => {
    const verdict = verdicts[0] ?? null;
    return { ...a, verdict, stale: verdict !== null && verdict.rubricVersion !== rubricVersion };
  });
}

/** The rubric version alone — what a running batch checks between applicants (DATA-4). */
export async function screeningStamp(id: number): Promise<{ rubricVersion: number } | null> {
  return prisma.screening.findUnique({ where: { id }, select: { rubricVersion: true } });
}

export async function getApplicant(id: number): Promise<(ApplicantWithVerdict & { screening: ScreeningWithJob }) | null> {
  const row = await prisma.applicant.findUnique({
    where: { id },
    omit: { original: true },
    include: {
      verdicts: { orderBy: { createdAt: 'desc' }, take: 1 },
      screening: {
        include: { job: { select: { id: true, title: true, employer: true, location: true, company: { select: { name: true, atsType: true } } } } },
      },
    },
  });
  if (!row) return null;
  const { verdicts, ...a } = row;
  const verdict = verdicts[0] ?? null;
  return { ...a, verdict, stale: verdict !== null && verdict.rubricVersion !== row.screening.rubricVersion };
}

export interface NewLetter {
  applicantId: number;
  sourceFilename: string;
  mimeType: string;
  original: Buffer;
  text: string;
}

/** Cover letters found in an upload, each on the applicant it belongs to (TASKS E3); one already attached is not attached twice. */
export async function createLetters(letters: NewLetter[]): Promise<number> {
  if (letters.length === 0) return 0;
  const existing = await prisma.applicantLetter.findMany({
    where: { applicantId: { in: [...new Set(letters.map((l) => l.applicantId))] } },
    select: { applicantId: true, text: true },
  });
  const seen = new Set(existing.map((e) => `${e.applicantId}\u0000${e.text}`));
  const fresh = letters.filter((l) => {
    const key = `${l.applicantId}\u0000${l.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) return 0;
  const out = await prisma.applicantLetter.createMany({ data: fresh.map((l) => ({ ...l, original: new Uint8Array(l.original) })) });
  return out.count;
}

/** An applicant's letters for the scorecard — the text to read, the bytes left in the database. */
export async function listLetters(applicantId: number): Promise<{ id: number; sourceFilename: string; text: string; createdAt: Date }[]> {
  return prisma.applicantLetter.findMany({
    where: { applicantId },
    orderBy: { id: 'asc' },
    select: { id: true, sourceFilename: true, text: true, createdAt: true },
  });
}

export async function getLetterFile(id: number): Promise<{ applicantId: number; original: Buffer; sourceFilename: string; mimeType: string } | null> {
  const row = await prisma.applicantLetter.findUnique({ where: { id }, select: { applicantId: true, original: true, sourceFilename: true, mimeType: true } });
  return row ? { ...row, original: Buffer.from(row.original) } : null;
}

export async function getApplicantFile(id: number): Promise<{ original: Buffer; sourceFilename: string; mimeType: string } | null> {
  const row = await prisma.applicant.findUnique({ where: { id }, select: { original: true, sourceFilename: true, mimeType: true } });
  return row ? { original: Buffer.from(row.original), sourceFilename: row.sourceFilename, mimeType: row.mimeType } : null;
}

export async function deleteApplicant(id: number): Promise<void> {
  await prisma.applicant.delete({ where: { id } });
}

/** The bulk delete — scoped to the screening, so a stray id from another one is ignored. */
export async function deleteApplicants(screeningId: number, ids: number[]): Promise<number> {
  const r = await prisma.applicant.deleteMany({ where: { screeningId, id: { in: ids } } });
  return r.count;
}

export const DECISIONS = ['interview', 'hold', 'declined'] as const;
export type Decision = (typeof DECISIONS)[number];

/** The person's decision — the one write the tool never makes on its own (ADR 0047). */
export async function setDecision(id: number, decision: Decision | null): Promise<void> {
  await prisma.applicant.update({ where: { id }, data: { decision, decidedAt: decision ? new Date() : null } });
}

export async function setDecisionMany(screeningId: number, ids: number[], decision: Decision | null): Promise<number> {
  const r = await prisma.applicant.updateMany({
    where: { screeningId, id: { in: ids } },
    data: { decision, decidedAt: decision ? new Date() : null },
  });
  return r.count;
}

/** The person's correction to the computed score, with its reason (ADR 0047 addendum). */
/**
 * A held applicant released for scoring by the person who read it (TASKS E4):
 * only a `held` row moves, so a stale form cannot turn an unreadable file
 * into a queued one. True when it moved.
 */
export async function releaseApplicant(screeningId: number, id: number): Promise<boolean> {
  const out = await prisma.applicant.updateMany({ where: { id, screeningId, parseStatus: 'held' }, data: { parseStatus: 'ok', parseNote: null } });
  return out.count > 0;
}

export async function setAdjustment(id: number, points: number, note: string | null): Promise<void> {
  await prisma.applicant.update({ where: { id }, data: { scoreAdjustment: points, adjustmentNote: points === 0 ? null : note } });
}

/** Readable applicants with no verdict under this rubric version — what a run (or a resumed run) scores. */
export async function listPending(screeningId: number, rubricVersion: number): Promise<Pick<Applicant, 'id' | 'number' | 'redactedText'>[]> {
  return prisma.applicant.findMany({
    where: { screeningId, parseStatus: 'ok', verdicts: { none: { rubricVersion } } },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, redactedText: true },
  });
}

/** The named readable applicants of one screening, for a "score again". */
export async function listReadable(screeningId: number, ids: number[]): Promise<Pick<Applicant, 'id' | 'number' | 'redactedText'>[]> {
  return prisma.applicant.findMany({
    where: { screeningId, parseStatus: 'ok', id: { in: ids } },
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
/** Rewrites a stored verdict after a re-anchor and re-score with the current rules (scripts/rescore-screenings.ts) — no call, same reply. */
export async function updateVerdictScore(id: number, input: { facts: unknown; breakdown: unknown; score: number; confidence: string; gateBucket: string }): Promise<void> {
  await prisma.screeningVerdict.update({
    where: { id },
    data: { ...input, facts: input.facts as Prisma.InputJsonValue, breakdown: input.breakdown as Prisma.InputJsonValue },
  });
}

/** A shortlist read head to head (plan §5.1): the two anchored readings, never a score. */
export async function createComparison(input: {
  screeningId: number;
  applicantIds: number[];
  rubricVersion: number;
  promptVersion: number;
  model: string;
  readings: unknown;
}): Promise<ScreeningComparison> {
  return prisma.screeningComparison.create({ data: { ...input, readings: input.readings as Prisma.InputJsonValue } });
}

/** The newest comparison of exactly these applicants, in any order; null when they were never compared. */
export async function latestComparison(screeningId: number, applicantIds: number[]): Promise<ScreeningComparison | null> {
  const rows = await prisma.screeningComparison.findMany({
    where: { screeningId, applicantIds: { hasEvery: applicantIds } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return rows.find((r) => r.applicantIds.length === applicantIds.length) ?? null;
}
