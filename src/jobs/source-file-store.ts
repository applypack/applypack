import { prisma } from '../db';
import { fromDbBigInt } from '../fingerprint';
import { logger } from '../logger';
import type { FileStatus, LedgerEntry } from '../datasets/folder-scan';
import { readSourceConfig } from '../datasets/map';
import type { StoredPosting } from '../datasets/posting-file';
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
/** The jobs the per-file list names beside a file; the rest are counted. */
const JOBS_SHOWN = 3;
/**
 * How long the ledger keeps a file that left the folder and brought no job
 * (#478): a tool that writes a file an hour and deletes it would otherwise
 * grow the ledger, and every look's read of it, for ever.
 */
const GONE_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

/** A folder's ledger as the scan plan reads it. */
export async function loadLedger(companyId: number): Promise<LedgerEntry[]> {
  const rows = await prisma.sourceFile.findMany({
    where: { companyId },
    select: {
      relPath: true,
      size: true,
      mtime: true,
      sha256: true,
      status: true,
      rowsRead: true,
      jobCount: true,
      turnedAway: true,
      windowTurnedAway: true,
      windowEndsAt: true,
      rulesKey: true,
    },
  });
  return rows.map(({ mtime, status, windowEndsAt, ...r }) => ({ ...r, mtimeMs: mtime.getTime(), status: status as FileStatus, windowEndsAt: windowEndsAt?.getTime() ?? null }));
}

/**
 * The jobs a folder of saved postings holds, the newest first, as much of
 * each as telling one posting from the next takes (posting-file.ts:
 * identifyPosting). A person's folder: hundreds of rows, never their text.
 */
export async function loadStoredPostings(companyId: number): Promise<StoredPosting[]> {
  const rows = await prisma.job.findMany({
    where: { companyId },
    orderBy: { id: 'desc' },
    select: { externalId: true, title: true, employer: true, url: true, sourceFile: true, descriptionSimhash: true },
  });
  return rows.map(({ descriptionSimhash, ...job }) => ({ ...job, fingerprint: fromDbBigInt(descriptionSimhash) }));
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
        turnedAway: change.turnedAway,
        windowTurnedAway: change.windowTurnedAway,
        windowEndsAt: change.windowEndsAt === null ? null : new Date(change.windowEndsAt),
        rulesKey: change.rulesKey ?? look.rulesKey,
        seenAt: look.at,
        goneAt: null,
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
        data: { seenAt: look.at, goneAt: null },
      });
    }
    // A file read before the rules were keyed takes the key of its first look since: nothing is read again on an upgrade (#448).
    if (look.rulesKey !== null) await tx.sourceFile.updateMany({ where: { companyId: look.companyId, rulesKey: null }, data: { rulesKey: look.rulesKey } });
    // What it did not list has left the folder, or the name filter: gone as of this look.
    await tx.sourceFile.updateMany({ where: { companyId: look.companyId, seenAt: { lt: look.at }, goneAt: null }, data: { goneAt: look.at } });
    // A file whose jobs name it stays on the list with them; one that brought none is forgotten after a while.
    await tx.$executeRaw`
      DELETE FROM source_file f
      WHERE f."companyId" = ${look.companyId} AND f."goneAt" < ${new Date(look.at.getTime() - GONE_KEPT_MS)}
        AND NOT EXISTS (SELECT 1 FROM job j WHERE j."companyId" = f."companyId" AND j."sourceFile" = f."relPath")`;
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
  /** Files of rows read with a part lost: a quote never closed, characters that could not be read (datasets/read-notes.ts). */
  partial: number;
  /** Set aside unread: a copy, too large, damaged, not rows or not a posting (#478). */
  skipped: number;
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
           count(*) FILTER (WHERE f."seenAt" = l.last AND f.status = 'failed')::int AS failed,
           count(*) FILTER (WHERE f."seenAt" = l.last AND f.status = 'done' AND f.detail IS NOT NULL AND f.kind IN ('json', 'jsonl', 'csv', 'tsv'))::int AS partial,
           count(*) FILTER (WHERE f."seenAt" = l.last AND f.status = 'skipped')::int AS skipped
    FROM source_file f
    JOIN (SELECT "companyId", max("seenAt") AS last FROM source_file GROUP BY "companyId") l ON l."companyId" = f."companyId"
    GROUP BY f."companyId", l.last`;
  return new Map(rows.map(({ companyId, ...summary }) => [companyId, summary]));
}

/**
 * How many switched-on folders of rows hold a file whose rows the rules
 * turned away: when a search changes or a company is unmuted, the next check
 * reads those files again (folder-scan.ts:judgedAgain), and the page where
 * the change is made says so (#448). A file read before rows were counted
 * may have had some; one not yet given a key is not read again, so it is not
 * counted either.
 */
export async function foldersToReadAgain(): Promise<number> {
  const turnedAway = { OR: [{ turnedAway: null }, { turnedAway: { gt: 0 } }, { windowTurnedAway: { gt: 0 } }] };
  const folders = await prisma.company.findMany({
    where: { atsType: 'FOLDER', active: true, sourceFiles: { some: { status: 'done', goneAt: null, rulesKey: { not: null }, ...turnedAway } } },
    select: { sourceConfig: true },
  });
  // A folder of saved postings stores every file it reads: nothing in it was turned away.
  return folders.filter((folder) => readSourceConfig(folder.sourceConfig)?.holds !== 'postings').length;
}

/**
 * A folder's mapping was saved again: the files the old one could not read
 * may fit the new one, so they wait for the next look. A file that was read
 * is left alone — its jobs are stored.
 */
export async function misfitsWaitAgain(companyId: number): Promise<void> {
  await prisma.sourceFile.updateMany({ where: { companyId, status: 'failed', sha256: { not: null } }, data: { status: 'waiting' } });
}

/**
 * "Read every file again" (#396): every file of a folder that a look read, in
 * whole or in part, waits for the next look and is read from its first row.
 * The file itself is not touched, only what the ledger says of it. Rows
 * already stored come back as duplicates, which cost nothing; rows a search
 * or a mute turned away the first time are judged as the rules stand now.
 * Only the files the last look listed: one that has left the folder cannot
 * be read, and its row would say "waiting" for ever. Returns how many wait.
 */
export async function readFilesAgain(companyId: number): Promise<number> {
  const { count } = await prisma.sourceFile.updateMany({
    where: { companyId, goneAt: null, status: { in: ['done', 'waiting'] }, sha256: { not: null } },
    data: { status: 'waiting', sha256: null, rowsRead: 0, detail: null },
  });
  return count;
}

/** A folder's files for its per-file list: the ones seen last first, then the newest. */
export async function listSourceFiles(companyId: number) {
  return prisma.sourceFile.findMany({
    where: { companyId },
    orderBy: [{ seenAt: 'desc' }, { mtime: 'desc' }, { relPath: 'asc' }],
    take: FILES_SHOWN,
  });
}

/** A job a file became, for the link beside it on the per-file list. */
interface FileJob {
  id: number;
  title: string;
  fitScore: number | null;
}

/** The first jobs a file became, and how many it became. */
export interface JobsOfFile {
  shown: FileJob[];
  total: number;
}

/**
 * The first jobs each file became, by the file the job names
 * (`Job.sourceFile`), and how many it became: three a file in one query,
 * whatever a file holds. A file a tool appends to can have brought tens of
 * thousands, and reading them all took a second to show three (#478).
 */
export async function jobsByFile(companyId: number, relPaths: readonly string[]): Promise<Map<string, JobsOfFile>> {
  const rows = await prisma.$queryRaw<(FileJob & { sourceFile: string; total: number })[]>`
    SELECT id, title, "fitScore", "sourceFile", total
    FROM (
      SELECT id, title, "fitScore", "sourceFile",
             row_number() OVER (PARTITION BY "sourceFile" ORDER BY id) AS n,
             (count(*) OVER (PARTITION BY "sourceFile"))::int AS total
      FROM job
      WHERE "companyId" = ${companyId} AND "sourceFile" = ANY(${[...relPaths]})
    ) j
    WHERE n <= ${JOBS_SHOWN}
    ORDER BY id`;
  const byFile = new Map<string, JobsOfFile>();
  for (const { sourceFile, total, ...job } of rows) {
    const entry = byFile.get(sourceFile) ?? { shown: [], total };
    entry.shown.push(job);
    byFile.set(sourceFile, entry);
  }
  return byFile;
}
