import { z } from 'zod';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';
import { PACK_STOPS, type PackStop, type PrepareStep } from './gate';
import type { HeldReason } from './policy';

/*
 * A stored pack in words: its states, what the `edits` column holds, the
 * sentences a page and a notification say about it. Pure — the store reads
 * the row, the page and the notifier put their own markup on these.
 */

const isPackStop = (v: unknown): v is PackStop => (PACK_STOPS as readonly unknown[]).includes(v);

const HELD_REASONS = ['no-wording', 'drops-figure', 'section', 'over-limit', 'removals-off'] as const satisfies readonly HeldReason[];

const EditsSchema = z.object({
  applied: z.number().int().min(0).catch(0).default(0),
  /** Operations the text could not take, by the editor's own error code. */
  unplaced: z.array(z.string()).catch([]).default([]),
  held: z
    .array(z.object({ section: z.string(), where: z.string(), reason: z.enum(HELD_REASONS) }))
    .catch([])
    .default([]),
  /** The checks that failed (tailor.ts); when any did, the resume was kept as it stood. */
  checks: z.array(z.string()).catch([]).default([]),
});
export type PackEdits = z.infer<typeof EditsSchema>;

export function readPackEdits(v: unknown): PackEdits {
  const parsed = EditsSchema.safeParse(v ?? {});
  return parsed.success ? parsed.data : EditsSchema.parse({});
}

/** Why a suggestion was left for the person, as the end of "… — <reason>": catalog keys, worded on the page. */
export const HELD_WORDS = {
  'no-wording': 'pack.held.noWording',
  'drops-figure': 'pack.held.dropsFigure',
  section: 'pack.held.section',
  'over-limit': 'pack.held.overLimit',
  'removals-off': 'pack.held.removalsOff',
} as const satisfies Record<HeldReason, MessageKey>;

/** The step a pack is on, as catalog keys: "Reading the posting". */
export const STEP_WORDS = {
  liveness: 'pack.step.liveness',
  brief: 'pack.step.brief',
  match: 'pack.step.match',
  verify: 'pack.step.verify',
  tailor: 'pack.step.tailor',
  rejudge: 'pack.step.rejudge',
  document: 'pack.step.document',
  letter: 'pack.step.letter',
} as const satisfies Record<PrepareStep, MessageKey>;

/**
 * Why a pack stopped, as the case the catalog's stop messages select on
 * (`pack.stop.title` on the card, `pack.notice.stop` in the message): a
 * selector takes no hyphen, and anything unknown is "stopped".
 */
const STOP_WORDS: Record<PackStop, string> = {
  closed: 'closed',
  'failed-gate': 'failed_gate',
  'low-ceiling': 'low_ceiling',
  fake: 'fake',
  skip: 'skip',
};

const stopCase = (stop: unknown): string => (isPackStop(stop) ? STOP_WORDS[stop] : 'other');

/** Why a pack stopped, as a heading: "The posting is closed." */
export function stopTitle(stop: unknown): string {
  return t('pack.stop.title', { stop: stopCase(stop) });
}

/** What the job page's tab says after "Application pack ·"; null while there is no pack. */
export function packFact(pack: { status: string; sentAt: Date | null } | null): string | null {
  if (!pack) return null;
  const fact = pack.sentAt ? 'sent' : pack.status === 'queued' || pack.status === 'running' ? 'preparing' : pack.status;
  return t('pack.fact', { fact });
}

export interface PackNotice {
  title: string;
  company: string;
  status: string;
  stop: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  /** The company check's verdict and recommendation; null when it was not checked. */
  verdict: string | null;
  recommendation: string | null;
}

/** "match 76 → 100 · company legit, apply" — the facts a ready pack is told by. */
export function packLine(pack: PackNotice): string {
  const match =
    pack.scoreBefore === null
      ? null
      : pack.scoreAfter === null || pack.scoreAfter === pack.scoreBefore
        ? t('pack.line.match', { score: pack.scoreBefore })
        : t('pack.line.matchMoved', { before: pack.scoreBefore, after: pack.scoreAfter });
  const company = !pack.verdict
    ? t('pack.line.companyUnchecked')
    : pack.recommendation
      ? t('pack.line.companyAdvice', { verdict: pack.verdict, recommendation: pack.recommendation })
      : t('pack.line.company', { verdict: pack.verdict });
  return [match, company].filter(Boolean).join(' · ');
}

/** The names a long message lists before it counts the rest. */
const NOTICE_MAX = 8;

/**
 * One grouped message for the packs that finished since the last one, as
 * plain lines: the ready ones first, then the ones not worth the evening —
 * knowing which postings to skip is half of what a pack is for.
 */
export function packNoticeLines(packs: PackNotice[]): string[] {
  const name = (p: PackNotice): string => `${p.title} — ${p.company}`;
  const ready = packs.filter((p) => p.status === 'ready');
  const stopped = packs.filter((p) => p.status === 'stopped');
  const lines: string[] = [];
  if (ready.length > 0) {
    lines.push(t('pack.notice.ready', { n: ready.length }));
    for (const p of ready.slice(0, NOTICE_MAX)) lines.push(`• ${name(p)} (${packLine(p)})`);
    if (ready.length > NOTICE_MAX) lines.push(t('pack.notice.more', { n: ready.length - NOTICE_MAX }));
    lines.push(t('pack.notice.open'));
  }
  if (stopped.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(t('pack.notice.stopped', { n: stopped.length }));
    for (const p of stopped.slice(0, NOTICE_MAX)) {
      lines.push(`• ${name(p)}: ${t('pack.notice.stop', { stop: stopCase(p.stop) })}`);
    }
    if (stopped.length > NOTICE_MAX) lines.push(t('pack.notice.more', { n: stopped.length - NOTICE_MAX }));
  }
  return lines;
}
