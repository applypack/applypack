import { GATE_BUCKET_LABELS, type ConfidenceBand, type GateBucket } from './score';
import type { GateStatus } from './prompts';

/*
 * The table as a file for the hiring manager (TASKS §19 stage 3): CSV for
 * a spreadsheet, Markdown for a mail or a doc. Pure — rows in, text out.
 */

export interface ExportRow {
  number: number;
  /** Shown to the person only; the model never saw it. */
  name: string | null;
  file: string;
  status: 'ok' | 'unreadable';
  note: string | null;
  bucket: GateBucket | null;
  /** The computed score. */
  score: number | null;
  /** The person's correction (ADR 0047 addendum), 0 when none, and the number the table orders by. */
  adjustment: number;
  adjustmentNote: string | null;
  adjusted: number | null;
  /** Another document of applicant №N. */
  sameAs: number | null;
  confidence: ConfidenceBand | null;
  gates: { gate: string; status: GateStatus }[];
  mustCovered: number | null;
  mustTotal: number | null;
  years: number | null;
  level: string | null;
  verdict: string | null;
  questions: string[];
  /** Facts no criterion asked for (plan §5); the career line read off the dated roles. Neither is scored. */
  standout: string[];
  career: string | null;
  decision: string | null;
}

export interface ExportScreening {
  title: string;
  jobTitle: string;
  companyName: string;
  gates: string[];
  createdAt: Date;
}

export const GATE_MARK: Record<GateStatus, string> = { pass: '✓', unknown: '?', fail: '✗' };

/** How far the person's correction may move a score either way — enough to lift a referral, never a rewrite of the rubric. */
export const MAX_ADJUSTMENT = 30;

export const DECISION_LABELS: Record<string, string> = {
  interview: 'To interview',
  hold: 'On hold',
  declined: 'Declined',
};

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 with a BOM, so Excel reads the Cyrillic names. */
export function toCsv(screening: ExportScreening, rows: ExportRow[]): string {
  const head = [
    'Applicant',
    'Name',
    'File',
    'Status',
    'Bucket',
    'Score',
    'Your adjustment',
    'Adjusted score',
    'Confidence',
    ...screening.gates.map((g) => `Gate: ${g}`),
    'Must-have covered',
    'Relevant years',
    'Level',
    'Career',
    'Decision',
    'Verdict',
    'Stands out',
    'Questions',
    'Note',
  ];
  const lines = rows.map((r) =>
    [
      `№${r.number}`,
      r.name ?? '',
      r.file,
      r.status,
      r.bucket ? GATE_BUCKET_LABELS[r.bucket] : '',
      r.score ?? '',
      r.adjustment === 0 ? '' : `${r.adjustment > 0 ? '+' : ''}${r.adjustment}${r.adjustmentNote ? ` (${r.adjustmentNote})` : ''}`,
      r.adjusted ?? '',
      r.confidence ?? '',
      ...screening.gates.map((g) => {
        const status = r.gates.find((x) => x.gate.toLowerCase() === g.toLowerCase())?.status;
        return status ? GATE_MARK[status] : '';
      }),
      r.mustTotal !== null ? `${r.mustCovered ?? 0}/${r.mustTotal}` : '',
      r.years ?? '',
      r.level ?? '',
      r.career ?? '',
      r.decision ? (DECISION_LABELS[r.decision] ?? r.decision) : '',
      r.verdict ?? '',
      r.standout.join(' | '),
      r.questions.join(' | '),
      [r.sameAs !== null ? `another document of №${r.sameAs}` : '', r.note ?? ''].filter(Boolean).join('; '),
    ]
      .map(csvCell)
      .join(','),
  );
  return `﻿${[head.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}

/** The same table as Markdown, one section per bucket, then the unread files. */
export function toMarkdown(screening: ExportScreening, rows: ExportRow[]): string {
  const out: string[] = [
    `# ${screening.title}`,
    '',
    `Position: ${screening.jobTitle} — ${screening.companyName}. Screened ${screening.createdAt.toISOString().slice(0, 10)}.`,
    '',
    'The order is a priority to talk to, read off the resumes against the rubric; a person decides. Names were never seen by the model.',
    '',
  ];
  const buckets: GateBucket[] = ['pass', 'ask', 'fail'];
  for (const b of buckets) {
    const group = rows.filter((r) => r.bucket === b);
    if (group.length === 0) continue;
    out.push(`## ${GATE_BUCKET_LABELS[b]} (${group.length})`, '');
    out.push(`| # | Name | Score | Confidence | ${screening.gates.map((g) => escapePipe(g)).join(' | ')}${screening.gates.length > 0 ? ' | ' : ''}Must-have | Years | Level | Decision |`);
    out.push(`|---|---|--:|---|${screening.gates.map(() => ':-:|').join('')}--:|--:|---|---|`);
    for (const r of group) {
      const marks = screening.gates.map((g) => {
        const status = r.gates.find((x) => x.gate.toLowerCase() === g.toLowerCase())?.status;
        return status ? GATE_MARK[status] : '';
      });
      const score = r.adjusted !== null && r.adjustment !== 0 ? `${r.adjusted} (${r.score} ${r.adjustment > 0 ? '+' : ''}${r.adjustment})` : (r.score ?? '');
      out.push(
        `| №${r.number} | ${escapePipe(r.name ?? '')} | ${score} | ${r.confidence ?? ''} | ${marks.join(' | ')}${marks.length > 0 ? ' | ' : ''}${
          r.mustTotal !== null ? `${r.mustCovered ?? 0}/${r.mustTotal}` : ''
        } | ${r.years ?? ''} | ${r.level ?? ''} | ${r.decision ? (DECISION_LABELS[r.decision] ?? r.decision) : ''} |`,
      );
    }
    out.push('');
    for (const r of group) {
      if (!r.verdict && r.questions.length === 0 && r.adjustment === 0 && r.standout.length === 0) continue;
      out.push(`**№${r.number}${r.name ? ` — ${escapePipe(r.name)}` : ''}.** ${r.verdict ?? ''}`);
      if (r.adjustment !== 0) out.push(`- Your adjustment: ${r.adjustment > 0 ? '+' : ''}${r.adjustment}${r.adjustmentNote ? ` — ${r.adjustmentNote}` : ''}`);
      if (r.standout.length > 0) out.push(`- Stands out: ${r.standout.join('; ')}`);
      if (r.career) out.push(`- Career: ${r.career}`);
      for (const q of r.questions) out.push(`- ${q}`);
      out.push('');
    }
  }
  const unread = rows.filter((r) => r.status !== 'ok');
  if (unread.length > 0) {
    out.push(`## Not screened (${unread.length})`, '');
    for (const r of unread) out.push(`- №${r.number} ${r.file}: ${r.note ?? r.status}`);
    out.push('');
  }
  return out.join('\n');
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|');
}
