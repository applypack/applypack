import { AtsType } from '@prisma/client';
import { logger } from '../logger';
import { prisma } from '../db';
import { decodeHtmlEntities, stripHtml } from '../http';

/*
 * One-shot repair for stored job descriptions.
 *
 * Until 2026-08 stripHtml stripped tags BEFORE decoding entities, so feeds
 * that ship the body HTML-escaped (Greenhouse) kept the full markup in the
 * stored text, and every feed lost its line structure. Re-running the fixed
 * stripHtml over stored rows restores paragraphs for every description that
 * still carries its markup. MANUAL rows are user-pasted plaintext — they
 * only get entity decoding (no tag stripping), matching createManualJob.
 *
 * Usage: node dist/scripts/backfill-descriptions.js [--dry-run]
 */

const DRY_RUN = process.argv.includes('--dry-run');
/** A cleanup that shrinks a long description this hard is a bug, not a fix. */
const SUSPICIOUS_MIN_CHARS = 200;
const SUSPICIOUS_SOURCE_CHARS = 1000;
const TAG_RE = /<(p|div|ul|ol|li|br|h[1-6]|strong|em|b|table|span|a)[ >/]/i;

async function main(): Promise<void> {
  const jobs = await prisma.job.findMany({
    select: { id: true, description: true, company: { select: { atsType: true } } },
    orderBy: { id: 'asc' },
  });

  let changed = 0;
  let hadMarkup = 0;
  let skippedSuspicious = 0;
  const samples: { id: number; before: string; after: string }[] = [];

  for (const job of jobs) {
    const before = job.description;
    if (before.length === 0) continue;
    // stripHtml is NOT idempotent on its own plaintext output (it reads
    // newlines as HTML whitespace), so only rows that still carry markup go
    // through it; everything else — MANUAL included — gets entity decoding.
    const after =
      job.company.atsType !== AtsType.MANUAL && TAG_RE.test(before)
        ? stripHtml(before)
        : decodeHtmlEntities(before).trim();
    if (after === before) continue;

    if (after.length < SUSPICIOUS_MIN_CHARS && before.length > SUSPICIOUS_SOURCE_CHARS) {
      skippedSuspicious++;
      logger.warn(
        { jobId: job.id, beforeChars: before.length, afterChars: after.length },
        'backfill-descriptions: suspicious shrink — skipped',
      );
      continue;
    }

    if (TAG_RE.test(before)) hadMarkup++;
    changed++;
    if (samples.length < 2 && TAG_RE.test(before)) {
      samples.push({ id: job.id, before: before.slice(0, 200), after: after.slice(0, 200) });
    }
    if (!DRY_RUN) {
      await prisma.job.update({ where: { id: job.id }, data: { description: after } });
    }
  }

  for (const s of samples) {
    logger.info({ jobId: s.id, before: s.before, after: s.after }, 'backfill-descriptions: sample');
  }
  logger.info(
    { scanned: jobs.length, changed, hadMarkup, skippedSuspicious, dryRun: DRY_RUN },
    DRY_RUN
      ? 'backfill-descriptions: dry run — nothing written'
      : 'backfill-descriptions: done',
  );
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'backfill-descriptions: failed');
    void prisma.$disconnect().finally(() => process.exit(1));
  });
