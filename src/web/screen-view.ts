import type { ApplicantWithVerdict } from '../screening/store';
import { readScreenReply, type GateStatus } from '../screening/prompts';
import { orderVerdicts, readScreenBreakdown, type CapReason, type ConfidenceBand, type GateBucket } from '../screening/score';
import type { ExportRow } from '../screening/export';
import { trajectoryLine, trajectoryOf, type Trajectory } from '../screening/trajectory';

/*
 * The screening table's rows, read off stored applicants and verdicts — one
 * shape for the page, the CSV and the Markdown. Pure: tested in
 * screen-view.test.ts.
 */

export interface VerdictView {
  score: number;
  confidence: ConfidenceBand;
  bucket: GateBucket;
  cap: number | null;
  capReason: CapReason | null;
  gates: { gate: string; status: GateStatus }[];
  /** Skill criteria evidenced at all, and in a role or in production — where two documents of one person differ. */
  mustCovered: number;
  mustTotal: number;
  mustStrong: number;
  years: number | null;
  level: string | null;
  injection: boolean;
  verdictLine: string;
  questions: string[];
  /** Facts no criterion asked for, each with its line (plan §5) — read, never scored. */
  standout: { fact: string; quote: string | null }[];
  /** The career as the dated roles give it — a fact, never a penalty (ADR 0047). */
  career: Trajectory;
  careerLine: string;
}

/** How many current verdicts predate an edit to the posting — the "posting changed" line. */
export function scoredBeforePosting(rows: { scoredAt: Date | null }[], postingUpdatedAt: Date | null): number {
  if (!postingUpdatedAt) return 0;
  return rows.filter((r) => r.scoredAt !== null && r.scoredAt < postingUpdatedAt).length;
}

export interface ApplicantRowView {
  id: number;
  number: number;
  name: string | null;
  file: string;
  status: 'ok' | 'unreadable';
  note: string | null;
  decision: string | null;
  /** Another document of an applicant already in the list — that one's №. */
  sameAs: number | null;
  /** The person's correction and its reason (ADR 0047 addendum); 0 = none. */
  adjustment: number;
  adjustmentNote: string | null;
  /** Scored under an earlier rubric — the number is about a different yardstick. */
  stale: boolean;
  /** When the current verdict was written; null without one. */
  scoredAt: Date | null;
  verdict: VerdictView | null;
}

/** The number the table orders by: the computed score plus the person's correction, held to 0–100. */
export function adjustedScore(score: number, adjustment: number): number {
  return Math.max(0, Math.min(100, score + adjustment));
}

export function rowView(a: ApplicantWithVerdict & { sameAsNumber?: number | null }, now = new Date()): ApplicantRowView {
  const status = a.parseStatus === 'unreadable' ? 'unreadable' : 'ok';
  const reply = a.verdict ? readScreenReply(a.verdict.facts) : null;
  const bd = a.verdict ? readScreenBreakdown(a.verdict.breakdown) : null;
  const verdict: VerdictView | null =
    a.verdict && reply && bd
      ? {
          score: bd.score,
          confidence: bd.confidence.band,
          bucket: bd.gateBucket,
          cap: bd.cap,
          capReason: bd.capReason,
          gates: bd.rows.filter((r) => r.mode === 'gate').map((r) => ({ gate: r.label, status: r.gate ?? 'unknown' })),
          mustCovered: bd.skillsCovered,
          mustTotal: bd.skillsTotal,
          mustStrong: bd.skillsStrong,
          years: bd.years,
          level: bd.level,
          injection: reply.injection,
          verdictLine: reply.summary.verdict,
          questions: reply.questions,
          standout: reply.standout,
          career: trajectoryOf(reply.roles, now),
          careerLine: trajectoryLine(trajectoryOf(reply.roles, now)),
        }
      : null;
  return {
    id: a.id,
    number: a.number,
    name: a.name,
    file: a.sourceFilename,
    status,
    note: a.parseNote,
    decision: a.decision,
    sameAs: a.sameAsNumber ?? null,
    adjustment: a.scoreAdjustment,
    adjustmentNote: a.adjustmentNote,
    stale: a.stale,
    scoredAt: a.verdict?.createdAt ?? null,
    verdict,
  };
}

export interface RowGroups {
  /** Scored under the current rubric, in the table's order. */
  scored: ApplicantRowView[];
  /** Readable, no current verdict (never scored, or scored under an older rubric). */
  pending: ApplicantRowView[];
  /** Unreadable files and copies. */
  unread: ApplicantRowView[];
}

export function groupRows(rows: ApplicantRowView[]): RowGroups {
  const scored = rows.filter((r) => r.verdict !== null && !r.stale && r.status === 'ok');
  const ordered = orderVerdicts(
    scored.map((r) => ({
      row: r,
      number: r.number,
      gateBucket: r.verdict!.bucket,
      score: adjustedScore(r.verdict!.score, r.adjustment),
      confidence: r.verdict!.confidence,
    })),
  ).map((x) => x.row);
  return {
    scored: ordered,
    pending: rows.filter((r) => r.status === 'ok' && (r.verdict === null || r.stale)),
    unread: rows.filter((r) => r.status !== 'ok'),
  };
}

/** The same rows as the exporters want them. */
export function exportRows(rows: ApplicantRowView[]): ExportRow[] {
  const groups = groupRows(rows);
  const toRow = (r: ApplicantRowView): ExportRow => ({
    number: r.number,
    name: r.name,
    file: r.file,
    status: r.status,
    note: r.note ?? (r.status === 'ok' && r.verdict === null ? 'not scored yet' : r.stale ? 'scored under an earlier rubric' : null),
    bucket: r.verdict && !r.stale ? r.verdict.bucket : null,
    score: r.verdict && !r.stale ? r.verdict.score : null,
    adjustment: r.adjustment,
    adjustmentNote: r.adjustmentNote,
    adjusted: r.verdict && !r.stale ? adjustedScore(r.verdict.score, r.adjustment) : null,
    sameAs: r.sameAs,
    confidence: r.verdict && !r.stale ? r.verdict.confidence : null,
    gates: r.verdict && !r.stale ? r.verdict.gates : [],
    mustCovered: r.verdict && !r.stale ? r.verdict.mustCovered : null,
    mustTotal: r.verdict && !r.stale ? r.verdict.mustTotal : null,
    years: r.verdict && !r.stale ? r.verdict.years : null,
    level: r.verdict && !r.stale ? r.verdict.level : null,
    verdict: r.verdict && !r.stale ? r.verdict.verdictLine : null,
    questions: r.verdict && !r.stale ? r.verdict.questions : [],
    standout: r.verdict && !r.stale ? r.verdict.standout.map((f) => f.fact) : [],
    career: r.verdict && !r.stale && r.verdict.career.roles > 0 ? r.verdict.careerLine : null,
    decision: r.decision,
  });
  return [...groups.scored, ...groups.pending, ...groups.unread].map(toRow);
}
