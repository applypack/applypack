import { logger } from '../logger';
import { prisma } from '../db';
import { scanResume } from '../resume/scan';

/*
 * Scan every stored resume again — the way a new upload is scanned — so a
 * field the scan learned later (ADR 0046: `industries`) is filled on the
 * resumes that predate it. One AI call per resume, the row updated in place,
 * nothing else touched; the hidden scratch resume of /target is skipped.
 *
 * Usage: node dist/scripts/rescan-resumes.js [--only <id>]
 */

const only = Number(process.argv[process.argv.indexOf('--only') + 1]);

async function main(): Promise<void> {
  const resumes = await prisma.resume.findMany({
    where: Number.isFinite(only) && only > 0 ? { id: only } : { hidden: false },
    select: { id: true, name: true, text: true },
    orderBy: { id: 'asc' },
  });
  for (const resume of resumes) {
    const scan = await scanResume(resume);
    logger.info(
      { id: resume.id, name: resume.name, industries: scan?.industries ?? null, ok: scan !== null },
      'rescan-resumes: scanned',
    );
  }
  logger.info({ resumes: resumes.length }, 'rescan-resumes: done');
}

main()
  .catch((err) => {
    logger.error({ err }, 'rescan-resumes: failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
