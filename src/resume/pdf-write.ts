/*
 * Cover letter → minimal single-font PDF (F8.2). US Letter, Helvetica 11pt,
 * WinAnsi encoding (Latin-1 names like Zoë survive; anything beyond becomes
 * "?"). Lines wrap by a conservative character budget — with an average
 * Helvetica glyph near 0.5 em, 80 characters sit well inside the 468 pt
 * text width, so a line can come up short but never overflows.
 * Pure: tested in pdf-write.test.ts, plus a real render check via smoke.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const FONT_SIZE = 11;
const LEADING = 16;
export const PDF_WRAP_CHARS = 80;
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEADING); // 40

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

export function buildLetterPdf(text: string): Buffer {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((l) => (l.trim().length === 0 ? [''] : wrapLine(l.trim())));
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push(['']);

  // Objects: 1 catalog, 2 pages, 3 font, then per page: page object + content.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  for (const [i, pageLines] of pages.entries()) {
    const shows = pageLines.map((l) => `(${pdfEscape(l)}) Tj T*`).join('\n');
    const stream = `BT\n/F1 ${FONT_SIZE} Tf\n${LEADING} TL\n${MARGIN} ${PAGE_H - MARGIN - FONT_SIZE} Td\n${shows}\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`,
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
