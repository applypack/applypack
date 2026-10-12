import { JobStatus } from '@prisma/client';
import { companyForMessage } from '../employer';
import { prisma } from '../db';
import { logger } from '../logger';
import { alertChannel, sendDigest, type Delivery } from '../notifier';
import { sourceLine } from '../web/pages/attribution';
import { shouldDeliverHeld, type Schedule } from '../user-schedule';
import { starred, watchRules } from '../watchlist/interval';
import { groupHeldByTarget, heldTitle, type HeldRow } from './held-alerts';
import type { AlertJob } from '../types';

/**
 * Delivery of the matches that could not be sent when they were scored: found
 * outside the alert window (TASKS §16), found while Alerts were switched off,
 * or refused by every chat. Held rows stay NEW with `alertHeldAt` set and
 * their verdicts already in job_score; this sends them as one grouped message
 * per chat on the first heartbeat the schedule allows — with Alerts on and a
 * chat to send to — and only then marks them ALERTED.
 *
 * It is called from the top of the fetch tick, above the pause and above the
 * schedule gate: these are matches this app has already found and already
 * scored. Nothing about "pause fetching" or "don't search at night" says the
 * user should not hear about them.
 *
 * An import sends its own matches the same way when it ends (#402): `only`
 * narrows the delivery to one source's rows and names the message after it.
 * What the schedule or the switch keeps back stays held, and leaves with the
 * next heartbeat's delivery like any other held match.
 */
export interface HeldDelivery {
  /** Listed in a message and marked ALERTED. */
  delivered: number;
  messages: number;
  /** Counted in a message's header, not listed: left New. */
  counted: number;
  /** In a message every chat refused: still held, for the next heartbeat. */
  failed: number;
}

export async function deliverHeldAlerts(
  now: Date,
  schedule: Schedule,
  only?: { companyId: number; title: string },
): Promise<HeldDelivery> {
  const nothing: HeldDelivery = { delivered: 0, messages: 0, counted: 0, failed: 0 };
  if (!shouldDeliverHeld(now, schedule)) return nothing;

  // A match can be dismissed, saved or applied to from the dashboard while it
  // waits — the row is on /jobs the whole time. Acting on it settles it: the
  // hold is moot, and delivering it would both pester the user about a
  // posting they have answered and overwrite their status with ALERTED.
  await prisma.job.updateMany({
    where: { alertHeldAt: { not: null }, status: { not: JobStatus.NEW } },
    data: { alertHeldAt: null },
  });

  // Alerts switched off, or no chat to send to: the rows keep waiting, as
  // they wait for the window. Asked before the rows are read, so an install
  // with Alerts off does not build the messages every hour to discard them.
  if ((await alertChannel()) !== 'open') return nothing;

  const rows = await prisma.job.findMany({
    where: { alertHeldAt: { not: null }, status: JobStatus.NEW, ...(only && { companyId: only.companyId }) },
    // The message's fields only (DATA-5).
    select: {
      id: true,
      title: true,
      employer: true,
      location: true,
      countries: true,
      workplace: true,
      url: true,
      fitScore: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
      techMatch: true,
      redFlags: true,
      summary: true,
      fetchedAt: true,
      sourceFile: true,
      company: { select: { name: true, atsType: true, atsToken: true, watched: true, alertPolicy: true } },
      scores: {
        select: { profile: { select: { name: true, notificationTargetId: true } } },
        orderBy: { fitScore: 'desc' },
        take: 2,
      },
    },
    orderBy: [{ fitScore: 'desc' }, { fetchedAt: 'desc' }],
  });
  if (rows.length === 0) return nothing;

  const held: HeldRow[] = rows.map((j) => ({
    id: j.id,
    targetId: j.scores[0]?.profile.notificationTargetId ?? null,
    alert: {
      title: j.title,
      // The ★ is on the row, not on the send: a held posting from a watched
      // company must read the same as one sent on the spot (ADR 0036).
      companyName: starred(companyForMessage(j.employer, j.company), watchRules(j.company)),
      watched: j.company.watched,
      attribution: sourceLine(j.sourceFile, j.company.name, j.company),
      location: j.location,
      countries: j.countries,
      workplace: j.workplace,
      url: j.url,
      fitScore: j.fitScore ?? 0,
      salaryMin: j.salaryMin,
      salaryMax: j.salaryMax,
      salaryCurrency: j.salaryCurrency,
      salaryPeriod: j.salaryPeriod,
      techMatch: j.techMatch,
      redFlags: j.redFlags,
      summary: j.summary ?? '',
      matchedProfile: j.scores.length > 1 ? (j.scores[0]?.profile.name ?? null) : null,
    } satisfies AlertJob,
  }));

  let delivered = 0;
  let messages = 0;
  let counted = 0;
  let failed = 0;
  for (const group of groupHeldByTarget(held)) {
    let delivery: Delivery;
    try {
      delivery = await sendDigest(group.alerts, group.targetId, [], only?.title ?? heldTitle(), group.unlisted.length);
    } catch (err) {
      // Every chat refused it. The rows keep alertHeldAt, so the next
      // heartbeat tries again rather than leaving a match the user never
      // hears about.
      logger.error({ err, targetId: group.targetId, count: group.ids.length }, 'alert-delivery: send failed, keeping the rows held');
      failed += group.ids.length + group.unlisted.length;
      continue;
    }
    // Switched off, or the last chat removed, since the check above: the
    // other groups would meet the same answer.
    if (delivery.skipped !== null) break;
    const { count } = await prisma.job.updateMany({
      // Still NEW: the same guard again, because the send takes seconds and
      // the dashboard is open. A row settled in between keeps the user's
      // status and simply loses its stamp on the next pass.
      where: { id: { in: group.ids }, status: JobStatus.NEW },
      data: { status: JobStatus.ALERTED, alertedAt: now, alertHeldAt: null },
    });
    // Counted in the header and left New: no longer waiting, never listed.
    if (group.unlisted.length > 0) {
      await prisma.job.updateMany({ where: { id: { in: group.unlisted } }, data: { alertHeldAt: null } });
    }
    delivered += count;
    counted += group.unlisted.length;
    messages++;
  }
  if (delivered > 0) logger.info({ delivered, messages, counted }, 'alert-delivery: held matches sent');
  return { delivered, messages, counted, failed };
}

/** How many matches are waiting — for the overview line and the settings card. */
export async function countHeldAlerts(): Promise<number> {
  return prisma.job.count({ where: { alertHeldAt: { not: null }, status: JobStatus.NEW } });
}
