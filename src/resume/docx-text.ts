import { readZipEntry } from './zip';

/*
 * .docx → plain text, the way an ATS parser sees it: one line per paragraph,
 * "- " for list items, "## " for headings, table rows as "cell | cell".
 * Regex over WordprocessingML rather than a DOM — the document part is
 * flat and predictable, and this keeps the module dependency-free.
 */

const DOCUMENT_PART = 'word/document.xml';
const HEADING_MAX_CHARS = 48;

export class ResumeTextError extends Error {}

export function docxToText(docx: Buffer): string {
  const part = readZipEntry(docx, DOCUMENT_PART);
  if (part === null) throw new ResumeTextError('not a .docx file (word/document.xml missing)');
  return documentXmlToText(part.toString('utf8'));
}

/** Pure: the XML of word/document.xml → text. Exported for tests. */
export function documentXmlToText(xml: string): string {
  const body = /<w:body>([\s\S]*?)<\/w:body>/.exec(xml)?.[1] ?? xml;
  return renderBlocks(body)
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const BLOCK_RE = /<w:(tbl|p)(?=[\s>/])/g;
const TABLE_BOUNDARY_RE = /<w:tbl(?=[\s>])|<\/w:tbl>/g;
const ROW_RE = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
const CELL_RE = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
const RUN_TOKEN_RE =
  /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<m:t(?:\s[^>]*)?>([^<]*)<\/m:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g;

function renderBlocks(xml: string): string[] {
  const out: string[] = [];
  const re = new RegExp(BLOCK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const start = m.index;
    if (m[1] === 'tbl') {
      const end = findTableEnd(xml, start);
      out.push(...renderTable(xml.slice(start, end)), '');
      re.lastIndex = end;
      continue;
    }
    const tagEnd = xml.indexOf('>', start);
    if (tagEnd === -1) break;
    if (xml[tagEnd - 1] === '/') {
      out.push('');
      re.lastIndex = tagEnd + 1;
      continue;
    }
    const close = xml.indexOf('</w:p>', tagEnd);
    const end = close === -1 ? xml.length : close + '</w:p>'.length;
    out.push(renderParagraph(xml.slice(start, end)));
    re.lastIndex = end;
  }
  return out;
}

function findTableEnd(xml: string, start: number): number {
  const re = new RegExp(TABLE_BOUNDARY_RE.source, 'g');
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    depth += m[0] === '</w:tbl>' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return xml.length;
}

function renderTable(tableXml: string): string[] {
  const rows: string[] = [];
  for (const row of tableXml.matchAll(ROW_RE)) {
    const cells: string[] = [];
    for (const cell of (row[1] ?? '').matchAll(CELL_RE)) {
      const text = renderBlocks(cell[1] ?? '')
        .filter((line) => line.length > 0)
        .join(' ');
      if (text.length > 0) cells.push(text);
    }
    if (cells.length > 0) rows.push(cells.join(' | '));
  }
  return rows;
}

function renderParagraph(paragraphXml: string): string {
  const props = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(paragraphXml)?.[1] ?? '';
  const isListItem = props.includes('<w:numPr>');
  const style = /<w:pStyle w:val="([^"]+)"/.exec(props)?.[1] ?? '';

  let raw = '';
  for (const token of paragraphXml.matchAll(RUN_TOKEN_RE)) {
    if (token[1] !== undefined) raw += token[1];
    else if (token[2] !== undefined) raw += token[2];
    else if (token[0] === '<w:tab/>') raw += '\t';
    else raw += '\n';
  }

  const lines = decodeXml(raw)
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]*\t[ \t]*/g, ' | ').replace(/ {2,}/g, ' ').trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return '';

  const text = lines.join('\n');
  if (isListItem) return `- ${text}`;
  if (/^Title$/i.test(style)) return `# ${text}`;
  if (/^Heading/i.test(style) || looksLikeHeading(text)) return `## ${text}`;
  return text;
}

/** ALL-CAPS short single line ("PROFESSIONAL EXPERIENCE") — the usual resume section marker. */
function looksLikeHeading(text: string): boolean {
  return (
    !text.includes('\n') &&
    text.length <= HEADING_MAX_CHARS &&
    /[A-Z]{3,}/.test(text) &&
    text === text.toUpperCase()
  );
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
