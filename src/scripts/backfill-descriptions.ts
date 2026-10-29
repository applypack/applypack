import { AtsType } from '@prisma/client';
import { logger } from '../logger';
import { prisma } from '../db';
import { simhash64, toDbBigInt } from '../fingerprint';
import { repairStoredText } from '../jobs/stored-text';
import { bringsRows } from '../web/source-groups';

/*
 * One-shot repair for the text of stored postings: what the fetchers write
 * now, applied to the rows they wrote before (`jobs/stored-text.ts`) — the
 * entities stripHtml left in descriptions and titles (#659), RemoteOK's
 * Latin-1 spelling of UTF-8, Golangprojects' employer in the title, DOU's
 * pay read as a place, 4dayweek's repeated places, HN's batch as a place
 * and the blanks around titles (#662). A body that still carries markup
 * from before 2026-08 is stripped as the first repair did.
 *
 * A pasted job and the rows the user brings are left alone: their text was
 * decoded once when it came in (gotcha 12).
 *
 * Usage: node dist/scripts/backfill-descriptions.js [--dry-run]
 */

const DRY_RUN = process.argv.includes('--dry-run');
/** A cleanup that shrinks a long description this hard is a bug, not a fix. */
const SUSPICIOUS_MIN_CHARS = 200;
const SUSPICIOUS_SOURCE_CHARS = 1000;
const SAMPLES_PER_COLUMN = 2;
const SAMPLE_LEAD_CHARS = 40;
const SAMPLE_CHARS = 160;
const COLUMNS = ['title', 'description', 'location', 'employer'] as const;

async function main(): Promise<void> {
  const jobs = await prisma.job.findMany({
    select: { id: true, title: true, description: true, location: true, employer: true, company: { select: { atsType: true } } },
    orderBy: { id: 'asc' },
  });

  let changed = 0;
  let skippedSuspicious = 0;
  const bySource = new Map<string, number>();
  const byColumn = new Map<string, number>();
  const samples: { jobId: number; column: string; before: string; after: string }[] = [];

  for (const job of jobs) {
    const atsType = job.company.atsType;
    if (atsType === AtsType.MANUAL || bringsRows(atsType)) continue;
    const repair = repairStoredText({ ...job, atsType });
    if (Object.keys(repair).length === 0) continue;

    if (repair.description !== undefined && repair.description.length < SUSPICIOUS_MIN_CHARS && job.description.length > SUSPICIOUS_SOURCE_CHARS) {
      skippedSuspicious++;
      logger.warn({ jobId: job.id, beforeChars: job.description.length, afterChars: repair.description.length }, 'backfill-descriptions: suspicious shrink — skipped');
      continue;
    }

    changed++;
    bySource.set(atsType, (bySource.get(atsType) ?? 0) + 1);
    for (const column of COLUMNS) {
      const after = repair[column];
      if (after === undefined) continue;
      byColumn.set(column, (byColumn.get(column) ?? 0) + 1);
      if (samples.filter((s) => s.column === column).length < SAMPLES_PER_COLUMN) {
        samples.push({ jobId: job.id, column, ...aroundChange(job[column] ?? '', after ?? '') });
      }
    }
    if (!DRY_RUN) {
      await prisma.job.update({
        where: { id: job.id },
        // The fingerprint is taken over the description (ADR 0018): it follows the text.
        data: repair.description === undefined ? repair : { ...repair, descriptionSimhash: toDbBigInt(simhash64(repair.description)) },
      });
    }
  }

  for (const s of samples) logger.info(s, 'backfill-descriptions: sample');
  logger.info(
    {
      scanned: jobs.length,
      changed,
      skippedSuspicious,
      bySource: Object.fromEntries(bySource),
      byColumn: Object.fromEntries(byColumn),
      dryRun: DRY_RUN,
    },
    DRY_RUN ? 'backfill-descriptions: dry run — nothing written' : 'backfill-descriptions: done',
  );
}

/** The two texts from a little before where they first differ, not the whole posting. */
function aroundChange(before: string, after: string): { before: string; after: string } {
  let at = 0;
  while (at < before.length && before[at] === after[at]) at++;
  const from = Math.max(0, at - SAMPLE_LEAD_CHARS);
  return { before: before.slice(from, from + SAMPLE_CHARS), after: after.slice(from, from + SAMPLE_CHARS) };
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'backfill-descriptions: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
