import type { ApplicantRow } from '../screening/store';
import { readScreenReply, type GateStatus } from '../screening/prompts';
import { orderVerdicts, readScreenBreakdown, type CapReason, type ConfidenceBand, type GateBucket } from '../screening/score';
import type { ExportRow } from '../screening/export';
import { trajectoryLine, trajectoryOf, type Trajectory } from '../screening/trajectory';
import { noteWords } from '../screening/redact';
import type { CalibrationRow, Decided } from '../screening/calibration';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

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

const CONFIDENCE_WORD: Record<ConfidenceBand, MessageKey> = { high: 'screen.confidence.high', medium: 'screen.confidence.medium', low: 'screen.confidence.low' };
/** A verdict's confidence band in a word. */
export function confidenceLabel(band: ConfidenceBand): string {
  return t(CONFIDENCE_WORD[band]);
}

/** The badge tone for every answer word a scorecard row can carry — rungs, statuses, impact and overall grades. */
export const ANSWER_TONE: Record<string, 'danger' | 'warn' | 'neutral' | 'ok'> = {
  absent: 'danger',
  listed: 'warn',
  project: 'neutral',
  role: 'ok',
  production: 'ok',
  pass: 'ok',
  partial: 'neutral',
  unknown: 'warn',
  fail: 'danger',
  strong: 'ok',
  ok: 'neutral',
  weak: 'danger',
  exceptional: 'ok',
  none: 'danger',
};

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
  /** `held`: the leak check found something after redaction; no model reads it until a person releases it (TASKS E4). */
  status: ApplicantStatus;
  note: string | null;
  decision: string | null;
  /** Another document of an applicant already in the list — that one's №. */
  sameAs: number | null;
  /** Cover letters attached to this applicant, read by a person only (TASKS E3). */
  letters: number;
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

export type ApplicantStatus = 'ok' | 'unreadable' | 'held';

/** A gate bucket's tone on every screening page (TASKS U18). */
export const BUCKET_TONE: Record<GateBucket, 'ok' | 'warn' | 'danger'> = { pass: 'ok', ask: 'warn', fail: 'danger' };

/** The stored `parseStatus`, read: anything unknown is a file that could not be read. */
export function applicantStatus(parseStatus: string): ApplicantStatus {
  return parseStatus === 'ok' || parseStatus === 'held' ? parseStatus : 'unreadable';
}

export function rowView(a: ApplicantRow & { sameAsNumber?: number | null }, now = new Date()): ApplicantRowView {
  const status = applicantStatus(a.parseStatus);
  const reply = a.verdict ? readScreenReply(a.verdict.facts) : null;
  const bd = a.verdict ? readScreenBreakdown(a.verdict.breakdown) : null;
  const career = reply ? trajectoryOf(reply.roles, now) : null;
  const verdict: VerdictView | null =
    a.verdict && reply && bd && career
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
          career,
          careerLine: trajectoryLine(career),
        }
      : null;
  return {
    id: a.id,
    number: a.number,
    name: a.name,
    file: a.sourceFilename,
    status,
    // Stored in English; worded for the page (an export runs in English and gets it back as stored).
    note: a.parseNote === null ? null : noteWords(a.parseNote),
    decision: a.decision,
    sameAs: a.sameAsNumber ?? null,
    letters: a.letters,
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
  /** Held back for a person's look before any model reads them (TASKS E4). */
  held: ApplicantRowView[];
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
    held: rows.filter((r) => r.status === 'held'),
    unread: rows.filter((r) => r.status === 'unreadable'),
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
  return [...groups.scored, ...groups.pending, ...groups.held, ...groups.unread].map(toRow);
}

/**
 * The scored rows as the calibration reads them (plan §6 stage E): the
 * table's order with and without the person's adjustments, and every
 * criterion's credit, answer and gate status off the stored breakdown.
 */
export function calibrationRows(applicants: ApplicantRow[], now = new Date()): CalibrationRow[] {
  const scored = groupRows(applicants.map((a) => rowView(a, now))).scored;
  const computed = orderVerdicts(scored.map((r) => ({ id: r.id, number: r.number, gateBucket: r.verdict!.bucket, score: r.verdict!.score, confidence: r.verdict!.confidence }))).map((x) => x.id);
  const byId = new Map(applicants.map((a) => [a.id, a]));
  return scored.map((r, i) => {
    const bd = readScreenBreakdown(byId.get(r.id)!.verdict!.breakdown)!;
    const credits: Record<string, number | null> = {};
    const answers: Record<string, string> = {};
    const gates: Record<string, GateStatus> = {};
    for (const row of bd.rows) {
      answers[row.id] = row.answer;
      if (row.mode === 'gate') gates[row.id] = row.gate ?? 'unknown';
      else if (row.mode === 'scored') credits[row.id] = row.credit;
    }
    return {
      number: r.number,
      position: i + 1,
      computedPosition: computed.indexOf(r.id) + 1,
      decision: r.decision as Decided | null,
      score: r.verdict!.score,
      adjusted: adjustedScore(r.verdict!.score, r.adjustment),
      bucket: r.verdict!.bucket,
      credits,
      answers,
      gates,
    };
  });
}
