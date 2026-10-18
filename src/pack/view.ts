import { z } from 'zod';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';
import { dashboardLink } from '../notify/dashboard-link';
import type { MessageLine } from '../notify/lines';
import { jobHref } from '../web/job-tabs';
import { PACK_STOPS, type PackStop, type PrepareStep } from './gate';
import type { HeldReason } from './policy';

/*
 * A stored pack in words: its states, what the `edits` column holds, the
 * sentences a page and a notification say about it. Pure — the store reads
 * the row, the page and the notifier put their own markup on these.
 */

const isPackStop = (v: unknown): v is PackStop => (PACK_STOPS as readonly unknown[]).includes(v);

const HELD_REASONS = ['no-wording', 'check-first', 'drops-figure', 'section', 'over-limit', 'removals-off'] as const satisfies readonly HeldReason[];

/** What one applied operation changed, with the text around it (text-edits.mjs:withContext) — its Undo. */
const InverseEditSchema = z.object({
  start: z.number().int().min(0),
  removed: z.string(),
  inserted: z.string(),
  lead: z.string().optional(),
  trail: z.string().optional(),
  leadUnique: z.boolean().optional(),
  trailUnique: z.boolean().optional(),
});

const EditsSchema = z.object({
  applied: z.number().int().min(0).catch(0).default(0),
  /**
   * Each applied operation under its card's key, in the order made — what the
   * Tailor page needs to open the pack's edits as applied cards (#487). Empty
   * on a pack prepared before it was kept, or when a check dropped the edits.
   */
  done: z
    .array(z.object({ key: z.string(), kind: z.string(), edit: InverseEditSchema }))
    .catch([])
    .default([]),
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

/** The Tailor page's record of what each card did (target-page.mjs, `target-edits:<matchId>`). */
export interface TailorEdits {
  applied: Record<string, z.infer<typeof InverseEditSchema>>;
  skipped: string[];
  order: string[];
}

/**
 * What the Tailor page opens a ready pack with (#487): the pack's text as the
 * draft over the comparison the edits came from, and each edit as Apply all
 * leaves it — under its card's key, in the order made — so every card reads
 * "Applied" with its Undo, and Undo all gives back the text that comparison
 * read. Not the comparison of the tailored text: its cards are new advice
 * about the edited resume, and none of them is the edit an Undo would take
 * back. Null when the pack changed nothing.
 */
export function tailorSeed(pack: { status: string; matchId: number | null; baseText: string | null; text: string | null; edits: unknown }): { text: string; edits: TailorEdits } | null {
  if (pack.status !== 'ready' || pack.matchId === null || !pack.text || pack.text === pack.baseText) return null;
  const { done } = readPackEdits(pack.edits);
  return {
    text: pack.text,
    edits: { applied: Object.fromEntries(done.map((d) => [d.key, d.edit])), skipped: [], order: done.map((d) => d.key) },
  };
}

/** Why a suggestion was left for the person, as the end of "… — <reason>": catalog keys, worded on the page. */
export const HELD_WORDS = {
  'no-wording': 'pack.held.noWording',
  'check-first': 'pack.held.checkFirst',
  'drops-figure': 'pack.held.dropsFigure',
  section: 'pack.held.section',
  'over-limit': 'pack.held.overLimit',
  'removals-off': 'pack.held.removalsOff',
} as const satisfies Record<HeldReason, MessageKey>;

/** Why an edit the plan allowed was not made in the text: the errors the editor's operations answer (text-edits.mjs). */
const UNPLACED_WORDS: Record<string, MessageKey> = {
  'not-found': 'pack.card.unplaced',
  protected: 'pack.card.unplaced.protected',
  'no-replacement': 'pack.card.unplaced.noWording',
};

/**
 * The edits that could not be made, one sentence per reason with its count.
 * The card said one reason for all of them — the quoted text is not in the
 * resume — and an edit refused for touching a contact line is not that (#384).
 */
export function unplacedLines(unplaced: readonly string[]): string[] {
  const counts = new Map<MessageKey, number>();
  for (const error of unplaced) {
    const key = Object.hasOwn(UNPLACED_WORDS, error) ? UNPLACED_WORDS[error]! : 'pack.card.unplaced.other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => t(key, { n }));
}

/** The step a pack is on, as catalog keys: "Reading the posting". */
const STEP_WORDS = {
  liveness: 'pack.step.liveness',
  brief: 'pack.step.brief',
  match: 'pack.step.match',
  verify: 'pack.step.verify',
  tailor: 'pack.step.tailor',
  rejudge: 'pack.step.rejudge',
  document: 'pack.step.document',
  letter: 'pack.step.letter',
} as const satisfies Record<PrepareStep, MessageKey>;

/** Whether a pack is still in the queue or being prepared: the one state of the tab that changes by itself. */
export function packBusy(pack: { status: string } | null): boolean {
  return pack?.status === 'queued' || pack?.status === 'running';
}

/** The sentence a pack in the queue or in flight is told by: where it waits, or the step it is on. */
export function preparingLine(pack: { status: string; step: string | null }): string {
  const step = STEP_WORDS[pack.step as PrepareStep] as MessageKey | undefined;
  const now = pack.status === 'queued' ? t('pack.card.queued') : t('pack.card.onStep', { step: step ? t(step) : t('pack.card.preparing') });
  return `${now} ${t('pack.card.refreshes')}`;
}

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
  jobId: number;
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
 * knowing which postings to skip is half of what a pack is for — and last
 * the ones that could not be prepared, which the job's page explains. With
 * the dashboard's address set, every pack's line links to its tab (#487).
 */
export function packNoticeLines(packs: PackNotice[], address: string | null = null): MessageLine[] {
  const name = (p: PackNotice): string => `${p.title} — ${p.company}`;
  const said = (text: string): MessageLine => ({ text, link: null });
  const pack = (p: PackNotice, text: string): MessageLine => ({ text, link: dashboardLink(address, jobHref(p.jobId, 'pack')) });
  const ready = packs.filter((p) => p.status === 'ready');
  const stopped = packs.filter((p) => p.status === 'stopped');
  const lines: MessageLine[] = [];
  if (ready.length > 0) {
    lines.push(said(t('pack.notice.ready', { n: ready.length })));
    for (const p of ready.slice(0, NOTICE_MAX)) lines.push(pack(p, `• ${name(p)} (${packLine(p)})`));
    if (ready.length > NOTICE_MAX) lines.push(said(t('pack.notice.more', { n: ready.length - NOTICE_MAX })));
    lines.push(said(t('pack.notice.open')));
  }
  if (stopped.length > 0) {
    if (lines.length > 0) lines.push(said(''));
    lines.push(said(t('pack.notice.stopped', { n: stopped.length })));
    for (const p of stopped.slice(0, NOTICE_MAX)) {
      lines.push(pack(p, `• ${name(p)}: ${t('pack.notice.stop', { stop: stopCase(p.stop) })}`));
    }
    if (stopped.length > NOTICE_MAX) lines.push(said(t('pack.notice.more', { n: stopped.length - NOTICE_MAX })));
  }
  const failed = packs.filter((p) => p.status === 'failed');
  if (failed.length > 0) {
    if (lines.length > 0) lines.push(said(''));
    lines.push(said(t('pack.notice.failed', { n: failed.length })));
    for (const p of failed.slice(0, NOTICE_MAX)) lines.push(pack(p, `• ${name(p)}`));
    if (failed.length > NOTICE_MAX) lines.push(said(t('pack.notice.more', { n: failed.length - NOTICE_MAX })));
  }
  return lines;
}
