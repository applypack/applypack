// ADR 0025: the board's work columns are user data. This is the pure
// half — parsing the stored JSON, list edits with their guards, and the
// presentation helpers the board derives from the configured order. The
// entry ('applied') and the exits ('rejected'/'ghosted') are fixed; only
// the columns between them are editable. Prisma access lives in settings.ts.

import { z } from 'zod';

export interface StageDef {
  key: string;
  label: string;
}

export const ENTRY_STAGE: StageDef = { key: 'applied', label: 'Applied' };
export const TERMINAL_STAGES: StageDef[] = [
  { key: 'rejected', label: 'Rejected' },
  { key: 'ghosted', label: 'Ghosted' },
];
export const TERMINAL_KEYS = TERMINAL_STAGES.map((s) => s.key);

export const DEFAULT_WORK_STAGES: StageDef[] = [
  { key: 'screen', label: 'Screen' },
  { key: 'tech', label: 'Tech' },
  { key: 'onsite', label: 'Onsite' },
  { key: 'offer', label: 'Offer' },
];

export const MAX_WORK_STAGES = 10;
const RESERVED_KEYS = new Set(['applied', 'rejected', 'ghosted']);

const StageListSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/),
      label: z.string().min(1).max(40),
    }),
  )
  .max(MAX_WORK_STAGES);

/** Stored JSON → work list; anything invalid falls back to the defaults. */
export function parseStageConfig(value: unknown): StageDef[] {
  if (value == null) return DEFAULT_WORK_STAGES;
  const parsed = StageListSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_WORK_STAGES;
  const seen = new Set<string>();
  const clean = parsed.data.filter((s) => {
    if (RESERVED_KEYS.has(s.key) || seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
  return clean.length > 0 ? clean : DEFAULT_WORK_STAGES;
}

export function slugifyLabel(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      // Room for a collision suffix without breaking the 40-char key schema.
      .slice(0, 36)
  );
}

export type StageEditError =
  | 'empty-label'
  | 'duplicate-label'
  | 'limit'
  | 'unknown-key'
  | 'last-column';

/** Append a new column; the key is a slug, unique against reserved + used. */
export function addStage(list: StageDef[], label: string): StageDef[] | StageEditError {
  const trimmed = label.trim();
  if (!trimmed) return 'empty-label';
  if (list.length >= MAX_WORK_STAGES) return 'limit';
  if (list.some((s) => s.label.toLowerCase() === trimmed.toLowerCase())) {
    return 'duplicate-label';
  }
  const base = slugifyLabel(trimmed) || 'stage';
  const taken = new Set([...RESERVED_KEYS, ...list.map((s) => s.key)]);
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return [...list, { key, label: trimmed.slice(0, 40) }];
}

/**
 * The job-count guard lives at the route — this only knows the list. The
 * last work column stays: an empty stored list would read as "use the
 * defaults" and silently resurrect all four.
 */
export function removeStage(list: StageDef[], key: string): StageDef[] | StageEditError {
  const next = list.filter((s) => s.key !== key);
  if (next.length === list.length) return 'unknown-key';
  return next.length === 0 ? 'last-column' : next;
}

/** Swap one step; already at the edge is a no-op, not an error. */
export function moveStage(list: StageDef[], key: string, dir: 'up' | 'down'): StageDef[] {
  const i = list.findIndex((s) => s.key === key);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Label changes; the key never does, so ledger history stays readable. */
export function renameStage(
  list: StageDef[],
  key: string,
  label: string,
): StageDef[] | StageEditError {
  const trimmed = label.trim();
  if (!trimmed) return 'empty-label';
  if (!list.some((s) => s.key === key)) return 'unknown-key';
  if (list.some((s) => s.key !== key && s.label.toLowerCase() === trimmed.toLowerCase())) {
    return 'duplicate-label';
  }
  return list.map((s) => (s.key === key ? { ...s, label: trimmed.slice(0, 40) } : s));
}

/** Ordered board columns: the fixed entry plus the configured work list. */
export function boardStages(work: StageDef[]): StageDef[] {
  return [ENTRY_STAGE, ...work];
}

/** Every stage a job can hold, in funnel order. */
export function allStages(work: StageDef[]): StageDef[] {
  return [ENTRY_STAGE, ...work, ...TERMINAL_STAGES];
}

export function labelFor(work: StageDef[], key: string): string {
  return allStages(work).find((s) => s.key === key)?.label ?? key;
}

/** Quick-move preselect: forward through the funnel, the last work column
 *  moves out to rejected, and a terminal card revives into the first work
 *  stage. */
export function nextStageKey(work: StageDef[], current: string): string {
  const board = boardStages(work);
  const i = board.findIndex((s) => s.key === current);
  if (i >= 0 && i < board.length - 1) return board[i + 1]!.key;
  if (i === board.length - 1) return 'rejected';
  return work[0]?.key ?? 'rejected';
}

/**
 * Column accent dot. Applied and the exits keep their fixed colours; work
 * columns cycle a palette — with the default list this reproduces the
 * pre-ADR-0025 dots exactly (violet, warn, hollow warn ring, ok).
 */
const DOT_CYCLE = [
  'bg-violet',
  'bg-warn',
  'border-2 border-warn bg-transparent',
  'bg-ok',
  'bg-danger',
  'bg-info',
];

export function dotClassFor(work: StageDef[], key: string): string {
  if (key === ENTRY_STAGE.key) return 'bg-info';
  if (TERMINAL_KEYS.includes(key)) return 'bg-line-strong';
  const i = work.findIndex((s) => s.key === key);
  return DOT_CYCLE[i % DOT_CYCLE.length] ?? 'bg-info';
}
