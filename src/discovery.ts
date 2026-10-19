import { CandidateStatus, type CompanyCandidate } from '@prisma/client';
import { prisma } from './db';
import { t } from './i18n/t';
import { logger } from './logger';
import { boardHints } from './watchlist/scan';

/** Boards read from one text: more is a list of links, not one employer's post. */
const MAX_BOARDS_PER_TEXT = 20;

/**
 * Record the boards a text links (HN comment, a feed's posting, …) as
 * candidates. Returns how many it added: each board once, however many of
 * its postings the text links, and never one already listed or already
 * tracked — the run rows used to count every mention, so an HN run said 61
 * where /discovery listed 32 (#542).
 */
export async function recordCandidatesFromText(
  text: string,
  source: string,
  options: { name?: string | null; sourceUrl?: string | null; signal?: string | null } = {},
): Promise<number> {
  const boards = boardHints(text).slice(0, MAX_BOARDS_PER_TEXT);
  if (boards.length === 0) return 0;
  // A board already tracked as a Company is already fetched.
  const tracked = await prisma.company.findMany({
    where: { OR: boards.map((b) => ({ atsType: b.atsType, atsToken: b.atsToken })) },
    select: { atsType: true, atsToken: true },
  });
  const known = new Set(tracked.map((c) => `${c.atsType}:${c.atsToken}`));
  // A candidate already listed keeps its row and its status: a PROMOTED or IGNORED one is not made PENDING again.
  const { count } = await prisma.companyCandidate.createMany({
    data: boards
      .filter((b) => !known.has(`${b.atsType}:${b.atsToken}`))
      .map((b) => ({
        name: options.name ?? null,
        atsType: b.atsType,
        atsToken: b.atsToken,
        source,
        sourceUrl: options.sourceUrl ?? b.url,
        signal: options.signal ?? null,
        status: CandidateStatus.PENDING,
      })),
    skipDuplicates: true,
  });
  return count;
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
    throw new Error(t('discovery.flash.candidateGone', { id }));
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
