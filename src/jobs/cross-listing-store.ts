import { prisma } from '../db';
import { titlesAgree } from '../fingerprint';
import { logger } from '../logger';

/**
 * The cross-listings stored before the title rule (#604, ADR 0018 addendum)
 * that join two different roles, taken off. The link is an annotation, so
 * the copy becomes a posting of its own again and nothing else changes.
 * Every boot: a link the rule made agrees, so after the first one nothing is
 * written.
 */
export async function unlinkOtherRoles(): Promise<void> {
  const copies = await prisma.job.findMany({
    where: { crossListedOfJobId: { not: null } },
    select: { id: true, title: true, crossListedOf: { select: { title: true } } },
  });
  const other = copies.filter((copy) => copy.crossListedOf !== null && !titlesAgree(copy.title, copy.crossListedOf.title)).map((copy) => copy.id);
  if (other.length === 0) return;
  await prisma.job.updateMany({ where: { id: { in: other } }, data: { crossListedOfJobId: null } });
  logger.info({ unlinked: other.length }, 'init: cross-listings of another role taken off');
}
