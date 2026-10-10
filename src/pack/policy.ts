import { proposalOf, suggestionKey } from '../resume/change-sheet';
import { effectiveKeywords } from '../resume/keyword-overrides';
import type { ACTION_SECTIONS, MatchAction, MatchKeyword, MatchRemoval } from '../resume/prompts';
import { hasCheckNote, instructionIn } from '../resume/replacement-gate';

/*
 * What an unattended tailoring may do to a resume, and the plan that holds a
 * comparison's suggestions to it. Pure — a stored report in, the editor's
 * operations out (src/web/public/apply-all.mjs runs them).
 *
 * The plan is the Tailor page's "Apply all" with the person's limits on it:
 * the same cards, the same wording the gate let through (ADR 0037), the same
 * keywords — minus what the policy does not allow, each one kept in `held`
 * with the reason, so a pack can say what it left for the person to decide.
 * The limits live here, in code, and not in a prompt: a rule the user can
 * lose a line of their resume to is not one to hope a model follows
 * (CLAUDE.md gotcha 11).
 */

export type ActionSection = (typeof ACTION_SECTIONS)[number];

export interface TailorPolicy {
  /** The sections a rewrite, an addition or a removal may touch. */
  sections: ActionSection[];
  /** Experience edits kept, the highest priority first: a light touch, not a rewrite. */
  maxBullets: number;
  /** Whether a line may be cut. */
  removals: boolean;
  /** Whether the keywords the resume backs are written onto its skills lines. */
  keywords: boolean;
}

/** Every keyword the resume backs, the lead lines, two bullets — and nothing cut. */
export const DEFAULT_POLICY: TailorPolicy = {
  sections: ['title', 'summary', 'skills', 'experience'],
  maxBullets: 2,
  removals: false,
  keywords: true,
};

/** The card operations of apply-all.mjs; `key` is the suggestion's (change-sheet.ts:suggestionKey). */
export type EditOperation =
  | { key: string; kind: 'change'; quote: string; wording: string }
  | { key: string; kind: 'add'; anchor: string; wording: string }
  | { key: string; kind: 'remove'; quote: string };

export interface SkillTerm {
  term: string;
  where?: string;
}

/**
 * `no-wording`: an instruction with nothing to paste, or wording the gate
 * refused. `drops-figure`: the new wording loses a number the line had.
 * `check-first`: the gate let the wording through with a note to check — a
 * skill nobody confirmed, a term the line loses. On the Tailor page the person
 * reads that note before pressing Apply; a pack is a file nobody has read yet.
 */
export type HeldReason = 'no-wording' | 'check-first' | 'drops-figure' | 'section' | 'over-limit' | 'removals-off';

export interface HeldEdit {
  section: ActionSection;
  where: string;
  reason: HeldReason;
}

export interface EditPlan {
  ops: EditOperation[];
  terms: SkillTerm[];
  held: HeldEdit[];
}

const PRIORITY_RANK: Record<MatchAction['priority'], number> = { high: 0, medium: 1, low: 2 };

/** Letters and digits alone: how two spellings of one phrase are told to be the same. */
const wordsOf = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** A number with what makes it one figure and not another: "$10M" is not the "10" of "10+ years". */
const figuresOf = (s: string): string[] =>
  (s.match(/[$€£]?\d+(?:[.,]\d+)*(?:\s?%|[kKmMbB]\b)?/g) ?? []).map((n) => n.toLowerCase().replace(/[,\s]/g, ''));

/**
 * Whether a rewrite loses a number the quoted text carried. The gate checks
 * that no figure is invented (ADR 0037); nothing checked that none is lost,
 * and "$10M+ ARR" left three summaries of seventeen on the dry run. A number
 * is what a recruiter stops on, so such an edit waits for the person.
 */
export function dropsFigure(quote: string, wording: string): boolean {
  const kept = new Set(figuresOf(wording));
  return figuresOf(quote).some((n) => !kept.has(n));
}

/**
 * The operation a card's Apply runs, or null when the card has none. A wording
 * that is a note to the writer has none either: the gate refuses it now, and a
 * comparison stored before it did still carries "(ask the candidate …)".
 */
function operationOf(action: MatchAction): EditOperation | null {
  const wording = proposalOf(action)?.text;
  if (!wording || instructionIn(wording, action.quote ?? '')) return null;
  const key = suggestionKey(action);
  if (action.quote) return { key, kind: 'change', quote: action.quote, wording };
  if (action.insert_after) return { key, kind: 'add', anchor: action.insert_after, wording };
  return null;
}

export function planEdits(
  report: {
    actions: MatchAction[];
    removals: MatchRemoval[];
    keywords: MatchKeyword[];
    /** The posting's title: the brief carries it as a keyword for the title line, and it is no skill. */
    postingTitle?: string;
  },
  policy: TailorPolicy,
): EditPlan {
  const ops: EditOperation[] = [];
  const held: HeldEdit[] = [];
  const hold = (item: { section: ActionSection; where: string }, reason: HeldReason): void => {
    held.push({ section: item.section, where: item.where, reason });
  };
  const allowed = (item: { section: ActionSection }): boolean => policy.sections.includes(item.section);

  // Two cards on one place share a key, and the page applies the first of them.
  const queued = new Set<string>();
  const open: { action: MatchAction; op: EditOperation }[] = [];
  for (const action of report.actions) {
    const op = operationOf(action);
    if (!op) hold(action, 'no-wording');
    else if (!allowed(action)) hold(action, 'section');
    else if (hasCheckNote(action)) hold(action, 'check-first');
    else if (op.kind === 'change' && dropsFigure(op.quote, op.wording)) hold(action, 'drops-figure');
    else if (!queued.has(op.key)) {
      queued.add(op.key);
      open.push({ action, op });
    }
  }
  // Array.sort is stable, so within one priority the report's own order decides.
  const bullets = new Set(
    open
      .filter((c) => c.action.section === 'experience')
      .sort((a, b) => PRIORITY_RANK[a.action.priority] - PRIORITY_RANK[b.action.priority])
      .slice(0, Math.max(0, policy.maxBullets))
      .map((c) => c.op),
  );
  for (const { action, op } of open) {
    if (action.section === 'experience' && !bullets.has(op)) hold(action, 'over-limit');
    else ops.push(op);
  }
  for (const removal of report.removals) {
    const key = suggestionKey(removal);
    if (!removal.quote) hold(removal, 'no-wording');
    else if (!policy.removals) hold(removal, 'removals-off');
    else if (!allowed(removal)) hold(removal, 'section');
    else if (hasCheckNote(removal)) hold(removal, 'check-first');
    else if (!queued.has(key)) {
      queued.add(key);
      ops.push({ key, kind: 'remove', quote: removal.quote });
    }
  }

  // What the page's "Add missing keywords" offers ticked: a weighted term the
  // resume backs and does not spell. A term nothing backs is never written,
  // and neither is the posting's own title — on the dry run three of the seven
  // terms written onto a skills line were "Senior Product Engineer (…)".
  const title = wordsOf(report.postingTitle ?? '');
  const terms = policy.keywords
    ? effectiveKeywords(report.keywords)
        .filter((k) => k.status === 'add' && k.requirement !== 'context' && wordsOf(k.term) !== title)
        .map((k) => (k.where ? { term: k.term, where: k.where } : { term: k.term }))
    : [];
  return { ops, terms, held };
}
