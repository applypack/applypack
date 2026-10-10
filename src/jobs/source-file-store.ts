import { prisma } from '../db';
import { logger } from '../logger';
import type { FileStatus, LedgerEntry } from '../datasets/folder-scan';
import type { FolderLook } from '../fetchers/folder-ledger';

/*
 * The database side of a folder source (ADR 0062): its ledger, `source_file`.
 * ApplyPack never writes into the folder, so what was read, what waits and
 * what was set aside is kept here. The decisions are folder-scan.ts's; this
 * module only reads and writes them, and only after the jobs of a look are
 * stored (fetchers/folder-ledger.ts).
 */

/** Postgres takes this many values in one statement; a folder can list more files than that. */
const IN_CHUNK = 10_000;
/** The per-file list shows the most recent of a folder's files. */
const FILES_SHOWN = 500;

/** A folder's ledger as the scan plan reads it. */
export async function loadLedger(companyId: number): Promise<LedgerEntry[]> {
  const rows = await prisma.sourceFile.findMany({
    where: { companyId },
    select: { relPath: true, size: true, mtime: true, sha256: true, status: true, rowsRead: true, jobCount: true },
  });
  return rows.map(({ mtime, status, ...r }) => ({ ...r, mtimeMs: mtime.getTime(), status: status as FileStatus }));
}

/**
 * What the looks of one tick learned, written once that tick's jobs are
 * stored: one transaction a folder, each on its own — a source deleted
 * meanwhile loses its look and nobody else's. A look not kept costs one more
 * read of the same files, which the stored jobs answer as duplicates.
 */
export async function keepFolderLooks(looks: readonly FolderLook[]): Promise<void> {
  for (const look of looks) {
    await keepLook(look).catch((err: unknown) => logger.warn({ err, companyId: look.companyId }, 'folder: look not kept in the ledger'));
  }
}

async function keepLook(look: FolderLook): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const change of look.changes) {
      const data = {
        size: change.size,
        mtime: new Date(change.mtimeMs),
        sha256: change.sha256,
        kind: change.kind,
        status: change.status,
        detail: change.detail,
        jobCount: change.jobCount,
        rowsRead: change.rowsRead,
        seenAt: look.at,
        // A file whose bytes were read, whatever became of them.
        ...(change.sha256 !== null && { readAt: look.at }),
      };
      await tx.sourceFile.upsert({
        where: { companyId_relPath: { companyId: look.companyId, relPath: change.relPath } },
        create: { companyId: look.companyId, relPath: change.relPath, ...data },
        update: data,
      });
    }
    // The files the look listed and the ledger already answers for were seen again.
    for (let i = 0; i < look.seen.length; i += IN_CHUNK) {
      await tx.sourceFile.updateMany({
        where: { companyId: look.companyId, relPath: { in: look.seen.slice(i, i + IN_CHUNK) } },
        data: { seenAt: look.at },
      });
    }
  });
}

export interface FolderSummary {
  /** The last look that listed a file of rows; null before the first. */
  lastLookAt: Date | null;
  /** Row files that look listed. */
  files: number;
  /** Of those, read as jobs at that look. */
  fresh: number;
  waiting: number;
  failed: number;
}

/**
 * "214 files · 3 new at the last check", for each folder source. The last
 * check is the last look that listed any row file: a look at a folder with
 * none in it changes no row, so an emptied folder keeps its last numbers.
 */
export async function folderSummaries(): Promise<Map<number, FolderSummary>> {
  const rows = await prisma.$queryRaw<({ companyId: number } & FolderSummary)[]>`
    SELECT f."companyId" AS "companyId", l.last AS "lastLookAt",
           count(*) FILTER (WHERE f."seenAt" = l.last)::int AS files,
           count(*) FILTER (WHERE f."readAt" = l.last AND f.status = 'done')::int AS fresh,
           count(*) FILTER (WHERE f."seenAt" = l.last AND f.status = 'waiting')::int AS waiting,
           count(*) FILTER (WHERE f."seenAt" = l.last AND f.status = 'failed')::int AS failed
    FROM source_file f
    JOIN (SELECT "companyId", max("seenAt") AS last FROM source_file GROUP BY "companyId") l ON l."companyId" = f."companyId"
    GROUP BY f."companyId", l.last`;
  return new Map(rows.map(({ companyId, ...summary }) => [companyId, summary]));
}

/** A folder's files for its per-file list: the ones seen last first, then the newest. */
export async function listSourceFiles(companyId: number) {
  return prisma.sourceFile.findMany({
    where: { companyId },
    orderBy: [{ seenAt: 'desc' }, { mtime: 'desc' }, { relPath: 'asc' }],
    take: FILES_SHOWN,
  });
}
