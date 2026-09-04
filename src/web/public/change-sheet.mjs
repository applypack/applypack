/*
 * "Copy my changes" — the edits the user made in the editor, as Markdown they
 * can paste into a mail or hand to whoever owns the real document. The other
 * half of the manual path ("Copy all suggestions") is rendered on the server
 * from src/resume/change-sheet.ts, because it needs no live text and must work
 * on /jobs/:id too.
 *
 * Dependency-free ES module, no DOM — unit-tested from src/web/target.test.ts.
 */

import { diffLines } from './line-diff.mjs';

/** A blank line has no content to quote; the sheet names it instead. */
const BLANK = '(blank line)';

function quote(text) {
  const body = text.trim();
  return body ? `> ${body}` : `> ${BLANK}`;
}

/**
 * The diff between the analysed text and the edited one, as Markdown. Returns
 * null when nothing changed, so the caller can keep the button disabled rather
 * than copy an empty sheet.
 */
export function formatEditSheet({ jobTitle, companyName, resumeName }, before, after) {
  const ops = diffLines(before, after).filter((d) => d.op !== 'keep');
  if (ops.length === 0) return null;

  const counts = { change: 0, insert: 0, delete: 0 };
  for (const d of ops) counts[d.op]++;
  const summary = [
    counts.change ? `${counts.change} reworded` : null,
    counts.insert ? `${counts.insert} added` : null,
    counts.delete ? `${counts.delete} removed` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const lines = [
    `# My resume edits — ${jobTitle} at ${companyName}`,
    '',
    `Resume: ${resumeName}`,
    `Lines: ${summary}. A line moved elsewhere reads as one removed and one added.`,
    '',
  ];
  ops.forEach((d, n) => {
    // Line numbers are 1-based for a human reading them beside their own document.
    if (d.op === 'change') {
      lines.push(`### ${n + 1}. Reworded — line ${d.a.i + 1}`, '', '**Was:**', '', quote(d.a.text), '', '**Now:**', '', quote(d.b.text), '');
    } else if (d.op === 'insert') {
      lines.push(`### ${n + 1}. Added — line ${d.b.i + 1}`, '', quote(d.b.text), '');
    } else {
      lines.push(`### ${n + 1}. Removed — line ${d.a.i + 1}`, '', quote(d.a.text), '');
    }
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
