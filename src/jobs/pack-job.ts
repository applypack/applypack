import type { Prisma } from '@prisma/client';
import { logger } from '../logger';
import { alertChannel, sendPackNotice } from '../notifier';
import { DEFAULT_MIN_CEILING } from '../pack/gate';
import { preparePosting, type Prepared } from '../pack/prepare';
import { wantsCoverLetter } from '../pack/settings';
import {
  claimNextPack,
  finishPack,
  hasQueuedPacks,
  listUnnotifiedPacks,
  loadPackInputs,
  markPacksNotified,
  requeueOrphans,
  setPackStep,
} from '../pack/store';
import { packNoticeLines, type PackEdits, type PackNotice } from '../pack/view';
import { getActiveProfile } from '../profiles';
import { readCoverAngles } from '../resume/prompts';
import { getPackSettings, getSchedule, getSettings } from '../settings';
import { shouldDeliverHeld } from '../user-schedule';
import type { CronStats } from './cron-run';
import { tryAdvisoryLock } from './fetch-lock';
import { t } from '../i18n/t';

/*
 * The pack runner (ADR 0063): the queued application packs, one at a time,
 * oldest first, and then one message for the ones that finished. The first
 * job in the worker that calls the resume module — a pack is a chain of the
 * calls the dashboard's buttons make, with nobody there to press them.
 *
 * It beats every minute and does nothing at all on a beat that finds no
 * queued row and no message owed, so an install that never switched the
 * feature on pays one indexed lookup a minute and no AI, ever.
 */

const PACK_LOCK_KEY = 0x41504b50; // "APKP" — the fetch lock's neighbour (fetch-lock.ts)

/** After a message every chat refused, the next try waits this long: a beat a minute must not mean an error a minute. */
const NOTICE_RETRY_MS = 15 * 60_000;

let stopping = false;
let noticeFailedAt = 0;

/** The worker is shutting down: no further pack is started, and the one in flight goes back in the queue. */
export function stopPackJob(): void {
  stopping = true;
}

/** Whether this beat has anything to do — asked before a run row is written. */
export async function packWorkWaiting(): Promise<boolean> {
  return (await hasQueuedPacks()) || (await noticesDue()).length > 0;
}

/**
 * The finished packs a message can carry NOW: the person's schedule lets a
 * held message out (user-schedule.ts), Alerts are not off, and the last try
 * did not just fail. Anything else waits without a run row a minute.
 */
async function noticesDue(): Promise<(PackNotice & { id: number })[]> {
  if (Date.now() - noticeFailedAt < NOTICE_RETRY_MS) return [];
  const waiting = await listUnnotifiedPacks();
  if (waiting.length === 0) return [];
  if (!shouldDeliverHeld(new Date(), await getSchedule())) return [];
  return (await alertChannel()) === 'alerts-off' ? [] : waiting;
}

export async function runPackJob(): Promise<{ stats: CronStats }> {
  const stats = { ready: 0, stopped: 0, failed: 0, requeued: 0, notified: 0 };
  // One runner at a time, across processes: a pack is minutes of AI, and two
  // runners would each take the "oldest" and could only race for the limit.
  const lock = await tryAdvisoryLock(PACK_LOCK_KEY);
  if (!lock) return { stats: { ...stats, reason: 'overlap' } };
  try {
    stats.requeued = await requeueOrphans();
    for (let next = stopping ? null : await claimNextPack(); next; next = stopping ? null : await claimNextPack()) {
      const { id, jobId } = next;
      // Whatever goes wrong with one pack ends with that pack: left `running`
      // it would be re-queued and tried again on every beat.
      const outcome = await runOne(id, jobId).catch(async (err: unknown) => {
        logger.error({ err, packId: id, jobId }, 'pack: failed outside its own steps');
        await finishPack(id, { status: 'failed', why: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
        return 'failed' as const;
      });
      stats[outcome]++;
    }
    stats.notified = await deliverNotices();
  } finally {
    await lock.release();
  }
  return { stats };
}

async function runOne(packId: number, jobId: number): Promise<'ready' | 'stopped' | 'failed' | 'requeued'> {
  const fail = async (why: string): Promise<'failed'> => {
    await finishPack(packId, { status: 'failed', why });
    return 'failed';
  };
  // Read per pack, not per beat: a setting changed while the queue runs applies to the next pack (gotcha 9).
  const [pack, settings, primary] = await Promise.all([getPackSettings(), getSettings(), getActiveProfile()]);
  const inputs = await loadPackInputs(jobId, primary?.resumeId ?? null);
  if (!inputs) return fail(t('pack.why.postingGone'));
  const { posting, resume } = inputs;
  if (!resume) {
    return fail(t('pack.why.noResume'));
  }

  let prepared: Prepared;
  try {
    prepared = await preparePosting(posting, resume, {
      minCeiling: DEFAULT_MIN_CEILING,
      policy: pack.policy,
      verify: true,
      rejudge: true,
      coverLetter: wantsCoverLetter(pack.coverLetter, posting.description),
      angles: readCoverAngles(settings.coverAngles),
      onStep: (step) => void setPackStep(packId, step).catch((err: unknown) => logger.warn({ err, packId }, 'pack: could not record the step')),
    });
  } catch (err) {
    logger.error({ err, packId, jobId }, 'pack: preparing threw');
    if (stopping) return requeue(packId);
    return fail(err instanceof Error ? err.message : String(err));
  }
  // A call cut short by the shutdown is not an answer about the posting.
  if (stopping && prepared.error) return requeue(packId);

  const read = {
    resumeId: resume.id,
    resumeName: resume.name,
    matchId: prepared.match?.id ?? null,
    verificationId: prepared.verification?.id ?? null,
    scoreBefore: prepared.match?.matchScore ?? null,
  };
  if (prepared.error) {
    await finishPack(packId, { ...read, status: 'failed', why: prepared.error });
    return 'failed';
  }
  if (prepared.stop) {
    await finishPack(packId, { ...read, status: 'stopped', stop: prepared.stop.stop, why: prepared.stop.why });
    logger.info({ packId, jobId, stop: prepared.stop.stop }, 'pack: stopped');
    return 'stopped';
  }
  const made = prepared.resume;
  if (!made || !prepared.match) return fail(t('pack.why.noResumeMade'));

  const edits: PackEdits = {
    applied: made.checks.length === 0 ? made.outcome.done.length : 0,
    unplaced: made.outcome.failed.map((f) => f.error),
    held: made.plan.held,
    checks: made.checks,
  };
  await finishPack(packId, {
    ...read,
    status: 'ready',
    why: prepared.unchecked ? t('pack.why.companyUnchecked', { reason: prepared.unchecked }) : null,
    tailoredMatchId: made.tailored?.id ?? null,
    coverLetterId: prepared.letterId,
    baseText: prepared.match.resumeText,
    text: made.text,
    edits: edits as unknown as Prisma.InputJsonValue,
    // The judged score of the tailored text when there is one, else the live floor.
    scoreAfter: made.tailored?.matchScore ?? made.score.after,
    docx: new Uint8Array(made.document.docx),
    pdf: made.document.pdf ? new Uint8Array(made.document.pdf) : null,
    document: made.document.kind,
    fileName: made.document.fileName,
  });
  logger.info({ packId, jobId, applied: edits.applied, held: edits.held.length, checks: edits.checks, ms: prepared.ms }, 'pack: ready');
  return 'ready';
}

async function requeue(packId: number): Promise<'requeued'> {
  await finishPack(packId, { status: 'queued', startedAt: null });
  return 'requeued';
}

/**
 * One message for every pack that finished since the last one. With no chat
 * to send to they are marked as told: there is nobody to keep trying for.
 */
async function deliverNotices(): Promise<number> {
  const due = await noticesDue();
  const lines = packNoticeLines(due);
  if (lines.length === 0) return 0;
  try {
    const delivery = await sendPackNotice(lines);
    if (delivery.skipped === 'alerts-off') return 0;
    await markPacksNotified(due.map((p) => p.id), new Date());
    return delivery.reached > 0 ? due.length : 0;
  } catch (err) {
    noticeFailedAt = Date.now();
    logger.warn({ err, packs: due.length }, 'pack: the notice reached nobody; it stays owed');
    return 0;
  }
}
