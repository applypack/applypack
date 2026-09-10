import { AtsType, CandidateStatus, type CompanyCandidate } from '@prisma/client';
import { prisma } from './db';
import { logger } from './logger';
import { extractAtsToken } from './text-utils';

export interface CandidateInput {
  atsType: AtsType;
  atsToken: string;
  name?: string | null;
  source: string;
  sourceUrl?: string | null;
  signal?: string | null;
}

/**
 * Idempotent: insert a candidate if (atsType, atsToken) is not already
 * known. If it exists, leave it alone (don't overwrite a PROMOTED row
 * with a fresh PENDING signal).
 */
async function recordCandidate(
  input: CandidateInput,
): Promise<CompanyCandidate | null> {
  // Don't propose candidates we already track in Company — they're already
  // being fetched.
  const existingCompany = await prisma.company.findUnique({
    where: {
      atsType_atsToken: { atsType: input.atsType, atsToken: input.atsToken },
    },
    select: { id: true },
  });
  if (existingCompany) return null;

  // Don't double-record candidates either.
  const existingCandidate = await prisma.companyCandidate.findUnique({
    where: {
      atsType_atsToken: { atsType: input.atsType, atsToken: input.atsToken },
    },
  });
  if (existingCandidate) return existingCandidate;

  return prisma.companyCandidate.create({
    data: {
      name: input.name ?? null,
      atsType: input.atsType,
      atsToken: input.atsToken,
      source: input.source,
      sourceUrl: input.sourceUrl ?? null,
      signal: input.signal ?? null,
      status: CandidateStatus.PENDING,
    },
  });
}

/**
 * Pull candidate URLs out of arbitrary text (HN comment, blog post, etc.)
 * and record any that match a known ATS pattern. Returns count recorded.
 */
export async function recordCandidatesFromText(
  text: string,
  source: string,
  options: { name?: string | null; sourceUrl?: string | null; signal?: string | null } = {},
): Promise<number> {
  const urls = (text.match(/https?:\/\/[^\s<>"')]+/gi) ?? []).slice(0, 20);
  let recorded = 0;
  for (const u of urls) {
    const ats = extractAtsToken(u);
    if (!ats) continue;
    const created = await recordCandidate({
      atsType: ats.atsType as AtsType,
      atsToken: ats.atsToken,
      name: options.name ?? null,
      source,
      sourceUrl: options.sourceUrl ?? u,
      signal: options.signal ?? null,
    });
    if (created) recorded++;
  }
  return recorded;
}

export async function listCandidates(
  status?: CandidateStatus,
): Promise<CompanyCandidate[]> {
  return prisma.companyCandidate.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ jobsSeen: 'desc' }, { discoveredAt: 'desc' }],
  });
}

export async function promoteCandidate(id: number): Promise<void> {
  const cand = await prisma.companyCandidate.findUnique({ where: { id } });
  if (!cand) {
    throw new Error(`Candidate ${id} not found`);
  }
  if (cand.status === CandidateStatus.PROMOTED) {
    return; // already done
  }

  await prisma.$transaction([
    prisma.company.upsert({
      where: {
        atsType_atsToken: {
          atsType: cand.atsType,
          atsToken: cand.atsToken,
        },
      },
      update: {},
      create: {
        name: cand.name ?? cand.atsToken,
        atsType: cand.atsType,
        atsToken: cand.atsToken,
        active: true,
      },
    }),
    prisma.companyCandidate.update({
      where: { id },
      data: { status: CandidateStatus.PROMOTED, promotedAt: new Date() },
    }),
  ]);
  logger.info(
    { id, atsType: cand.atsType, atsToken: cand.atsToken, name: cand.name },
    'discovery: candidate promoted',
  );
}

/** False when no such candidate — a missing row is an answer, not a 500 (audit 2026-09-10, ROUTE-2). */
export async function ignoreCandidate(id: number): Promise<boolean> {
  const { count } = await prisma.companyCandidate.updateMany({
    where: { id },
    data: { status: CandidateStatus.IGNORED },
  });
  return count > 0;
}

export async function deleteCandidate(id: number): Promise<boolean> {
  const { count } = await prisma.companyCandidate.deleteMany({ where: { id } });
  return count > 0;
}
