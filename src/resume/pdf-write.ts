import type { LetterHead, Paper } from './letter-head';

/*
 * Cover letter → minimal PDF (F8.2). Helvetica 11pt (the sender's name in
 * its bold) on the posting's paper — A4, or US Letter for the US and
 * Canada (#581) — WinAnsi encoding (Latin-1 names like Zoë survive; anything
 * beyond becomes "?"). Lines wrap by a conservative character budget — with an
 * average Helvetica glyph near 0.5 em, 80 characters sit well inside Letter's
 * 468 pt text width, and A4 takes the same share of its narrower one — so a
 * line can come up short but never overflows.
 * Pure: tested in pdf-write.test.ts, plus a real render check via smoke.
 */

/** Points: A4 is 210 × 297 mm. */
const PAGE: Record<Paper, { w: number; h: number }> = {
  letter: { w: 612, h: 792 },
  a4: { w: 595.28, h: 841.89 },
};
const MARGIN = 72;
const FONT_SIZE = 11;
const LEADING = 16;
const PDF_WRAP_CHARS = 80;
/** The text width the wrap budget was measured on: Letter's. */
const WRAP_WIDTH = PAGE.letter.w - 2 * MARGIN;

/** Word wrap by character budget; a single overlong token is hard-broken. */
export function wrapLine(line: string, max = PDF_WRAP_CHARS): string[] {
  if (line.length <= max) return [line];
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    let w = word;
    while (w.length > max) {
      if (current) out.push(current);
      out.push(w.slice(0, max));
      w = w.slice(max);
      current = '';
    }
    if (!current) current = w;
    else if (current.length + 1 + w.length <= max) current = `${current} ${w}`;
    else {
      out.push(current);
      current = w;
    }
  }
  if (current) out.push(current);
  return out;
}

/** PDF string literal in WinAnsi: escape delimiters, octal-escape Latin-1. */
export function pdfEscape(line: string): string {
  let out = '';
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code >= 32 && code < 127) out += ch;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += '?';
  }
  return out;
}

/** A line as drawn: its words, and whether they are set in bold (the sender's name). */
interface DrawnLine {
  text: string;
  bold?: boolean;
}

/** The sender's name, their contact line and the date, each followed by the gap a letter leaves. */
function headLines(head: LetterHead | undefined): DrawnLine[] {
  if (!head) return [];
  const sender: DrawnLine[] = [...(head.name ? [{ text: head.name, bold: true }] : []), ...(head.contact ? [{ text: head.contact }] : [])];
  return [...sender, ...(sender.length > 0 ? [{ text: '' }] : []), { text: head.date }, { text: '' }];
}

export function buildLetterPdf(text: string, { paper = 'letter', head }: { paper?: Paper; head?: LetterHead } = {}): Buffer {
  const page = PAGE[paper];
  const wrapAt = Math.floor((PDF_WRAP_CHARS * (page.w - 2 * MARGIN)) / WRAP_WIDTH);
  const linesPerPage = Math.floor((page.h - 2 * MARGIN) / LEADING);
  const letter = text.replace(/\r\n/g, '\n').split('\n').map((l): DrawnLine => ({ text: l }));
  const lines = [...headLines(head), ...letter].flatMap((l) =>
    l.text.trim().length === 0 ? [{ text: '' }] : wrapLine(l.text.trim(), wrapAt).map((part) => ({ text: part, bold: l.bold })),
  );
  const pages: DrawnLine[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push([{ text: '' }]);

  // Objects: 1 catalog, 2 pages, 3 font, 4 its bold, then per page: page object + content.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
  for (const [i, pageLines] of pages.entries()) {
    const shows = pageLines.map((l) => `${l.bold ? '/F2' : '/F1'} ${FONT_SIZE} Tf (${pdfEscape(l.text)}) Tj T*`).join('\n');
    const stream = `BT\n${LEADING} TL\n${MARGIN} ${page.h - MARGIN - FONT_SIZE} Td\n${shows}\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.w} ${page.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
