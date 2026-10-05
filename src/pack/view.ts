import { z } from 'zod';
import { PACK_STOPS, type PackStop, type PrepareStep } from './gate';
import type { HeldReason } from './policy';

/*
 * A stored pack in words: its states, what the `edits` column holds, the
 * sentences a page and a notification say about it. Pure — the store reads
 * the row, the page and the notifier put their own markup on these.
 */

export const PACK_STATUSES = ['queued', 'running', 'ready', 'stopped', 'failed'] as const;
export type PackStatus = (typeof PACK_STATUSES)[number];

export const isPackStatus = (v: unknown): v is PackStatus => (PACK_STATUSES as readonly unknown[]).includes(v);
export const isPackStop = (v: unknown): v is PackStop => (PACK_STOPS as readonly unknown[]).includes(v);

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

/** Why a suggestion was left for the person, as the end of "… — <reason>". */
export const HELD_WORDS: Record<HeldReason, string> = {
  'no-wording': 'an instruction with no wording to paste, or wording the fact check refused',
  'drops-figure': 'the new wording loses a number the line had',
  section: 'this section is closed to automatic edits',
  'over-limit': 'over the limit of experience bullets',
  'removals-off': 'nothing is removed automatically',
};

export const STOP_WORDS: Record<PackStop, string> = {
  closed: 'The posting is closed',
  'failed-gate': 'The posting requires something the resume does not show',
  'low-ceiling': 'The resume cannot get close enough to this posting',
  fake: 'The posting looks fake',
  skip: 'Not worth applying to',
};

export const STEP_WORDS: Record<PrepareStep, string> = {
  liveness: 'Checking that the posting is still open',
  brief: 'Reading the posting',
  match: 'Comparing it with your resume',
  verify: 'Checking the company on the web',
  tailor: 'Applying the edits',
  rejudge: 'Judging the tailored resume',
  document: 'Drawing the file',
  letter: 'Writing the cover letter',
};

/** What the job page's tab says after "Application pack ·"; null while there is no pack. */
export function packFact(pack: { status: string; sentAt: Date | null } | null): string | null {
  if (!pack) return null;
  if (pack.sentAt) return 'sent';
  if (pack.status === 'queued' || pack.status === 'running') return 'preparing';
  return pack.status === 'stopped' ? 'not worth it' : pack.status;
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
        ? `match ${pack.scoreBefore}`
        : `match ${pack.scoreBefore} → ${pack.scoreAfter}`;
  const company = pack.verdict ? `company ${pack.verdict}${pack.recommendation ? `, ${pack.recommendation}` : ''}` : 'company not checked';
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
    lines.push(ready.length === 1 ? 'An application pack is ready:' : `${ready.length} application packs are ready:`);
    for (const p of ready.slice(0, NOTICE_MAX)) lines.push(`• ${name(p)} (${packLine(p)})`);
    if (ready.length > NOTICE_MAX) lines.push(`…and ${ready.length - NOTICE_MAX} more.`);
    lines.push('Open the job in ApplyPack → Application pack: read the edits, download the resume, apply.');
  }
  if (stopped.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(stopped.length === 1 ? 'Not worth your time:' : `Not worth your time (${stopped.length}):`);
    for (const p of stopped.slice(0, NOTICE_MAX)) {
      lines.push(`• ${name(p)}: ${(isPackStop(p.stop) ? STOP_WORDS[p.stop] : 'stopped').toLowerCase()}`);
    }
    if (stopped.length > NOTICE_MAX) lines.push(`…and ${stopped.length - NOTICE_MAX} more.`);
  }
  return lines;
}
