import { JobStatus } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { sendDigest } from '../notifier';
import { attributionLine } from '../web/pages/attribution';
import { shouldDeliverHeld, type Schedule } from '../user-schedule';
import { groupHeldByTarget, HELD_TITLE, type HeldRow } from './held-alerts';
import type { AlertJob } from '../types';

/**
 * Delivery of the matches that were scored outside the alert window (TASKS
 * §16). Held rows stay NEW with `alertHeldAt` set and their verdicts already
 * in job_score; this sends them as one grouped message per chat on the first
 * heartbeat the schedule allows, and only then marks them ALERTED.
 *
 * It is called from the top of the fetch tick, above the pause and above the
 * schedule gate: these are matches this app has already found and already
 * scored. Nothing about "pause fetching" or "don't search at night" says the
 * user should not hear about them.
 */
export async function deliverHeldAlerts(now: Date, schedule: Schedule): Promise<{ delivered: number; messages: number }> {
  if (!shouldDeliverHeld(now, schedule)) return { delivered: 0, messages: 0 };

  const rows = await prisma.job.findMany({
    where: { alertHeldAt: { not: null } },
    include: {
      company: { select: { name: true, atsType: true, atsToken: true } },
      scores: {
        include: { profile: { select: { name: true, telegramTargetId: true } } },
        orderBy: { fitScore: 'desc' },
        take: 2,
      },
    },
    orderBy: [{ fitScore: 'desc' }, { fetchedAt: 'desc' }],
  });
  if (rows.length === 0) return { delivered: 0, messages: 0 };

  const held: HeldRow[] = rows.map((j) => ({
    id: j.id,
    targetId: j.scores[0]?.profile.telegramTargetId ?? null,
    alert: {
      title: j.title,
      companyName: j.company.name,
      attribution: attributionLine(j.company.atsType, j.company.atsToken),
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
  for (const group of groupHeldByTarget(held)) {
    try {
      await sendDigest(group.alerts, group.targetId, [], HELD_TITLE);
    } catch (err) {
      // The rows keep alertHeldAt, so the next heartbeat tries again rather
      // than leaving a match the user never hears about.
      logger.error({ err, targetId: group.targetId, count: group.ids.length }, 'alert-delivery: send failed, keeping the rows held');
      continue;
    }
    const { count } = await prisma.job.updateMany({
      where: { id: { in: group.ids } },
      data: { status: JobStatus.ALERTED, alertedAt: now, alertHeldAt: null },
    });
    delivered += count;
    messages++;
  }
  if (delivered > 0) logger.info({ delivered, messages }, 'alert-delivery: held matches sent');
  return { delivered, messages };
}

/** How many matches are waiting — for the overview line and the settings card. */
export async function countHeldAlerts(): Promise<number> {
  return prisma.job.count({ where: { alertHeldAt: { not: null } } });
}
