import { prisma } from '../db';
import { logger } from '../logger';
import { alertChannel, sendPageChangeAlert, type Delivery } from '../notifier';
import { checkPostingUrl } from './posting-url';
import { takePageChanges } from '../watchlist/page-changes';
import { shouldDeliverHeld, type Schedule } from '../user-schedule';

/**
 * Delivery for the change watch (TASKS §17 stage C, ADR 0036).
 *
 * `fetchers/career-page.ts` stages what it saw during the walk. After the walk
 * `recordPageChanges` writes it down: a first read stores its hash, a change
 * becomes the row's `pendingContentHash`. `deliverPageChanges` sends every
 * pending change in one grouped message and only then advances
 * `lastContentHash`, so a change that could not be delivered stays pending.
 *
 * The notice keeps to the held matches' rules (TASKS §16): it goes out on
 * the first heartbeat the schedule allows — any hour with alerts sent right
 * away, the hours of the window, the digest times — with Alerts on and a chat
 * to send to. It is on the row, not in memory, because the page may not be
 * read again at such an hour: a weekly check, or a 304 that says nothing new.
 * With no chat at all the row on /companies is the report ("changed 2h ago"),
 * so the change is taken as reported at once — as a match with no chat stays
 * New on the dashboard rather than waiting.
 */

/** After the walk: a first read stores its hash and says nothing; a change waits to be sent. */
export async function recordPageChanges(): Promise<void> {
  for (const change of takePageChanges()) {
    await prisma.company.update({
      where: { id: change.companyId },
      data: change.announce ? { pendingContentHash: change.hash } : { lastContentHash: change.hash },
    });
  }
}

/**
 * Called at the top of the fetch tick — above the pause and the fetch
 * schedule, like the held matches — and again after the walk, so a change
 * seen inside the alert hours goes out in the tick that saw it.
 */
export async function deliverPageChanges(now: Date, schedule: Schedule): Promise<{ alerted: number }> {
  const channel = await alertChannel();
  if (channel === 'alerts-off' || (channel === 'open' && !shouldDeliverHeld(now, schedule))) return { alerted: 0 };
  const pending = await prisma.company.findMany({
    where: { pendingContentHash: { not: null }, active: true },
    select: { id: true, name: true, atsToken: true, pendingContentHash: true },
    orderBy: { name: 'asc' },
  });
  // The link the fetcher reads (`career-page.ts:careerPageUrl`). A URL the
  // check now refuses is one the fetcher refuses too; it is left out rather
  // than failing everyone else's notice.
  const linked = pending.flatMap((c) => {
    const checked = checkPostingUrl(c.atsToken);
    return checked.ok ? [{ ...c, url: checked.url.toString() }] : [];
  });
  if (linked.length === 0) return { alerted: 0 };

  if (channel === 'open') {
    let delivery: Delivery;
    try {
      delivery = await sendPageChangeAlert(linked.map((c) => ({ companyName: c.name, url: c.url })));
    } catch (err) {
      // Every chat refused it; the rows keep their pending hash for the next heartbeat.
      logger.error({ err, pages: linked.length }, 'page-change: send failed, leaving them pending');
      return { alerted: 0 };
    }
    // Switched off since the check above.
    if (delivery.skipped === 'alerts-off') return { alerted: 0 };
  }

  for (const company of linked) {
    // Only the hash that was reported: a newer one written by a tick that
    // ran meanwhile ("Fetch now" beside the cron) stays pending.
    await prisma.company.updateMany({
      where: { id: company.id, pendingContentHash: company.pendingContentHash },
      data: { lastContentHash: company.pendingContentHash, lastContentAlertAt: now, pendingContentHash: null },
    });
  }
  logger.info({ pages: linked.length }, 'page-change: reported');
  return { alerted: linked.length };
}
