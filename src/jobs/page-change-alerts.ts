import { prisma } from '../db';
import { logger } from '../logger';
import { sendPageChangeAlert } from '../notifier';
import { takePageChanges } from '../watchlist/page-changes';
import { canAlertNow, type Schedule } from '../user-schedule';

/**
 * Delivery for the change watch (TASKS §17 stage C, ADR 0036).
 *
 * `fetchers/career-page.ts` stages a changed page during the walk; this sends
 * one grouped message and only then advances `lastContentHash`. The order
 * matters: a change we could not deliver stays pending, because the row still
 * holds the text we last reported.
 *
 * Outside the user's alert window nothing is sent and nothing is advanced —
 * the next heartbeat inside it finds the page still different and reports it.
 * That is simpler than a second held-alert table and gives the same answer:
 * "the page changed" is a standing fact, not an event that expires.
 */
export async function deliverPageChanges(now: Date, schedule: Schedule): Promise<{ alerted: number }> {
  const staged = takePageChanges();
  if (staged.length === 0) return { alerted: 0 };

  // A page seen for the first time has no news in it: store the hash so the
  // next check has something to compare against, and say nothing.
  for (const first of staged.filter((c) => !c.announce)) {
    await prisma.company.update({ where: { id: first.companyId }, data: { lastContentHash: first.hash } });
  }

  const changes = staged.filter((c) => c.announce);
  if (changes.length === 0) return { alerted: 0 };
  if (!canAlertNow(now, schedule)) {
    logger.info({ pages: changes.length }, 'page-change: outside the alert window; leaving them pending');
    return { alerted: 0 };
  }

  try {
    await sendPageChangeAlert(changes.map((c) => ({ companyName: c.companyName, url: c.url })));
  } catch (err) {
    // The hashes are untouched, so the next tick sees the same difference.
    logger.error({ err, pages: changes.length }, 'page-change: send failed, leaving them pending');
    return { alerted: 0 };
  }

  for (const change of changes) {
    await prisma.company.update({
      where: { id: change.companyId },
      data: { lastContentHash: change.hash, lastContentAlertAt: now },
    });
  }
  logger.info({ pages: changes.length }, 'page-change: reported');
  return { alerted: changes.length };
}
