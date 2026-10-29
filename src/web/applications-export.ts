import { csvTable } from '../csv';
import { dayIn } from '../zoned-day';

/*
 * The applications board as a file (TASKS N7): CSV for a spreadsheet, and
 * Markdown to read or paste. People keep a spreadsheet of their applications
 * anyway; this one is written from the board instead of by hand. Pure —
 * tested in applications-export.test.ts.
 */

/** One application as the export writes it. */
export interface ApplicationExportRow {
  /** The key of the column it sits in; `stage` below is that column's label. */
  stageKey: string;
  stage: string;
  /** Who hires; empty when the posting names nobody. */
  company: string;
  /** The aggregator, file or folder the posting came through; empty when the source is the employer's own board. */
  source: string;
  title: string;
  appliedAt: Date | null;
  /** When it entered its current column, from the stage ledger; null when nothing dates it. */
  stageSince: Date | null;
  fitScore: number | null;
  /** "Senior Backend v3" (jobs/applied-with.ts). */
  resume: string | null;
  recruiterContact: string | null;
  notes: string | null;
  url: string;
}

const HEAD = ['Stage', 'Company', 'Source', 'Title', 'Applied on', 'In this stage since', 'Fit', 'Applied with', 'Recruiter contact', 'Notes', 'Posting'];

export function applicationsCsv(rows: readonly ApplicationExportRow[], timeZone: string): string {
  return csvTable(
    HEAD,
    rows.map((r) => [
      r.stage,
      r.company,
      r.source,
      r.title,
      dayIn(r.appliedAt, timeZone),
      dayIn(r.stageSince, timeZone),
      r.fitScore ?? '',
      r.resume ?? '',
      r.recruiterContact ?? '',
      r.notes ?? '',
      r.url,
    ]),
  );
}

/** Characters that would turn a job title or a note into Markdown it never was. */
function mdText(s: string): string {
  return s.replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

/**
 * One section per column in the board's order, each application a list item:
 * the facts on one line, the recruiter and the notes indented under it. A
 * column with nothing in it is left out.
 */
export function applicationsMarkdown(
  rows: readonly ApplicationExportRow[],
  columns: readonly { key: string; label: string }[],
  timeZone: string,
  now: Date,
): string {
  const out = [`# Applications — ${dayIn(now, timeZone)}`, '', `${rows.length} ${rows.length === 1 ? 'application' : 'applications'}.`];
  for (const column of columns) {
    const inColumn = rows.filter((r) => r.stageKey === column.key);
    if (inColumn.length === 0) continue;
    out.push('', `## ${mdText(column.label)} (${inColumn.length})`, '');
    for (const r of inColumn) {
      const facts = [
        r.company ? mdText(r.company) : null,
        r.source ? `via ${mdText(r.source)}` : null,
        r.appliedAt ? `applied ${dayIn(r.appliedAt, timeZone)}` : null,
        r.stageSince ? `here since ${dayIn(r.stageSince, timeZone)}` : null,
        r.fitScore !== null ? `fit ${r.fitScore}` : null,
        r.resume ? `with ${mdText(r.resume)}` : null,
        /^https?:\/\//i.test(r.url) ? `[posting](<${r.url.replace(/>/g, '%3E')}>)` : null,
      ].filter((f): f is string => f !== null);
      out.push(`- **${mdText(r.title)}** — ${facts.join(' · ')}`);
      if (r.recruiterContact) out.push(`  - Recruiter: ${mdText(r.recruiterContact)}`);
      if (r.notes?.trim()) {
        const [first, ...more] = r.notes.trim().split(/\r?\n/);
        out.push(`  - Notes: ${mdText(first ?? '')}`, ...more.map((line) => `    ${mdText(line)}`));
      }
    }
  }
  return `${out.join('\n')}\n`;
}
