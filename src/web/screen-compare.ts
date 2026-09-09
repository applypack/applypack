import type { ApplicantWithVerdict } from '../screening/store';
import { readScreenReply } from '../screening/prompts';
import { readScreenBreakdown, type ConfidenceBand, type GateBucket, type ScoreRow } from '../screening/score';
import type { Criterion, Rubric } from '../screening/rubric';
import { trajectoryLine, trajectoryOf } from '../screening/trajectory';
import { adjustedScore } from './screen-view';

/*
 * Side by side (plan §5): the ticked applicants as columns, the criteria as
 * rows, the stored answers with their quotes in the cells — the view that
 * answers "why is №15 above №22" without a second AI call. Pure: tested in
 * screen-compare.test.ts.
 */

export interface CompareColumn {
  id: number;
  number: number;
  name: string | null;
  score: number;
  adjusted: number;
  adjustment: number;
  bucket: GateBucket;
  confidence: ConfidenceBand;
  years: number | null;
  level: string | null;
  career: string | null;
  standout: string[];
  verdictLine: string;
  /** The scorecard row per criterion id. */
  rows: Map<string, ScoreRow>;
}

export interface CompareRow {
  id: string;
  label: string;
  kind: Criterion['kind'];
  mode: Criterion['mode'];
  /** One per column; null when that verdict has no row for the criterion. */
  cells: (ScoreRow | null)[];
}

export interface SideBySide {
  columns: CompareColumn[];
  rows: CompareRow[];
}

/** Applicants with a verdict under the current rubric, aligned criterion by criterion; anyone without one is left out. */
export function sideBySide(rubric: Rubric, applicants: ApplicantWithVerdict[], now: Date): SideBySide {
  const columns: CompareColumn[] = [];
  for (const a of applicants) {
    if (!a.verdict || a.stale) continue;
    const reply = readScreenReply(a.verdict.facts);
    const bd = readScreenBreakdown(a.verdict.breakdown);
    if (!reply || !bd) continue;
    const career = trajectoryOf(reply.roles, now);
    columns.push({
      id: a.id,
      number: a.number,
      name: a.name,
      score: bd.score,
      adjusted: adjustedScore(bd.score, a.scoreAdjustment),
      adjustment: a.scoreAdjustment,
      bucket: bd.gateBucket,
      confidence: bd.confidence.band,
      years: bd.years,
      level: bd.level,
      career: career.roles > 0 ? trajectoryLine(career) : null,
      standout: reply.standout.map((f) => f.fact),
      verdictLine: reply.summary.verdict,
      rows: new Map(bd.rows.map((r) => [r.id, r])),
    });
  }
  const rows = rubric.criteria.map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    mode: c.mode,
    cells: columns.map((col) => col.rows.get(c.id) ?? null),
  }));
  return { columns, rows };
}
