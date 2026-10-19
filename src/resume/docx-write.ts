import type { LetterHead, Paper } from './letter-head';
import { buildZip } from './zip-write';

/*
 * Cover letter → minimal .docx (F8.2). Three parts are all Word, Google Docs
 * and LibreOffice need; one paragraph per input line, blank lines become
 * empty paragraphs, the sender's name and contacts and the date on top, on
 * the posting's paper (#581). Pure: round-trip-tested against our own docx
 * reader in docx-write.test.ts.
 */

/** Page size in twentieths of a point; the margins are an inch all round. */
const PAGE_SIZE: Record<Paper, { w: number; h: number }> = {
  letter: { w: 12240, h: 15840 },
  a4: { w: 11906, h: 16838 },
};

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const paragraph = (line: string, bold = false): string =>
  line.trim().length === 0
    ? '<w:p/>'
    : `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;

/** The sender's name (bold), their contact line and the date, each followed by the gap a letter leaves. */
function headParagraphs(head: LetterHead | undefined): string[] {
  if (!head) return [];
  const sender = [...(head.name ? [paragraph(head.name, true)] : []), ...(head.contact ? [paragraph(head.contact)] : [])];
  return [...sender, ...(sender.length > 0 ? [paragraph('')] : []), paragraph(head.date), paragraph('')];
}

export function buildLetterDocx(text: string, { paper = 'letter', head }: { paper?: Paper; head?: LetterHead } = {}): Buffer {
  const paragraphs = [...headParagraphs(head), ...text.replace(/\r\n/g, '\n').split('\n').map((line) => paragraph(line))].join('');
  const size = PAGE_SIZE[paper];
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="${size.w}" w:h="${size.h}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ]);
}
