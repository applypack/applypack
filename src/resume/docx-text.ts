import { DOMParser } from '@xmldom/xmldom';
import type { Document, Element, Node } from '@xmldom/xmldom';
import { readZipEntry } from './zip';
import type { MessageKey } from '../i18n/catalog';
import { SOURCE_LOCALE, withLocale } from '../i18n/locale';
import type { MessageParams } from '../i18n/message';
import { t } from '../i18n/t';

/*
 * .docx → plain text, the way an ATS parser sees it: one line per paragraph,
 * "- " for list items, "## " for headings, table rows as "cell | cell".
 *
 * Two readers produce that text. The DOM walk (`walkDocument`) is the primary
 * one since ADR 0038: it hands the patcher the paragraph nodes behind every
 * line, so an edit made in the editor can be written back into the same
 * `w:p`. The regex reader it replaced stays as the fallback for a file whose
 * XML the parser refuses — some producers emit invalid XML, and a resume
 * that cannot be patched must still be readable. A parity test holds the two
 * to the same output on every fixture.
 */

const DOCUMENT_PART = 'word/document.xml';
const HEADING_MAX_CHARS = 48;
export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/** Why a file gave no resume text: one row each, worded by the catalog (`resume.read.*`). */
const READ_FAILURES = {
  notDocx: 'resume.read.notDocx',
  badXml: 'resume.read.badXml',
  pdfPassword: 'resume.read.pdfPassword',
  pdfUnreadable: 'resume.read.pdfUnreadable',
  pdfNoExtract: 'resume.read.pdfNoExtract',
  pdfNoText: 'resume.read.pdfNoText',
  docxTooLarge: 'resume.read.docxTooLarge',
  notZip: 'resume.read.notZip',
  unsupported: 'resume.read.unsupported',
  tooShort: 'resume.read.tooShort',
} as const satisfies Record<string, MessageKey>;

type ReadFailure = keyof typeof READ_FAILURES;

/**
 * A file that gave no resume text. `message` is English whatever the reader's
 * language — a log reads it and a screening stores it as the applicant's note —
 * and `reason()` is the same sentence in the reader's language (ADR 0061).
 */
export class ResumeTextError extends Error {
  constructor(
    readonly failure: ReadFailure,
    readonly params: MessageParams = {},
  ) {
    super(withLocale(SOURCE_LOCALE, () => t(READ_FAILURES[failure], params)));
  }

  reason(): string {
    return t(READ_FAILURES[this.failure], this.params);
  }
}

/** The stored English notes that carry a number or a name, read back into their parameters. */
const STORED_NOTES: [RegExp, ReadFailure, (m: RegExpExecArray) => MessageParams][] = [
  [/^Only (\d+) characters? of text came out of the file — is it a real resume\?$/, 'tooShort', (m) => ({ n: Number(m[1]) })],
  [/^Only (\d+) characters? of text came out of the PDF — /, 'pdfNoText', (m) => ({ n: Number(m[1]) })],
  [/^Unsupported file type "(.*)"\. Upload (.*)\.$/, 'unsupported', (m) => ({ ext: m[1]!, accepted: m[2]! })],
  [/^The \.docx is larger inside than this tool reads \((.+) MB in one part\)\.$/, 'docxTooLarge', (m) => ({ mb: m[1]! })],
  [/^document\.xml: (.*)$/s, 'badXml', (m) => ({ detail: m[1]! })],
];

/**
 * A note a screening stored from `ResumeTextError.message`, in the reader's
 * language; null when the note is not one of these.
 */
export function storedReadNote(note: string): string | null {
  for (const [pattern, failure, params] of STORED_NOTES) {
    const m = pattern.exec(note);
    if (m) return t(READ_FAILURES[failure], params(m));
  }
  for (const failure of Object.keys(READ_FAILURES) as ReadFailure[]) {
    if (withLocale(SOURCE_LOCALE, () => t(READ_FAILURES[failure])) === note) return t(READ_FAILURES[failure]);
  }
  return null;
}

export function docxToText(docx: Buffer): string {
  const part = readZipEntry(docx, DOCUMENT_PART);
  if (part === null) throw new ResumeTextError('notDocx');
  return documentXmlToText(part.toString('utf8'));
}

/** Pure: the XML of word/document.xml → text. The DOM path, the regex reader when xmldom refuses the file. */
export function documentXmlToText(xml: string): string {
  let doc: Document;
  try {
    doc = parseDocumentXml(xml);
  } catch {
    return foldLines(regexRenderBlocks(bodyOf(xml)));
  }
  return blocksToText(walkDocument(doc));
}

/** xmldom with fatal errors thrown, so a malformed part lands in the fallback rather than in a half-read document. */
export function parseDocumentXml(xml: string): Document {
  return new DOMParser({
    onError: (level, message) => {
      if (level === 'fatalError' || level === 'error') throw new ResumeTextError('badXml', { detail: message });
    },
  }).parseFromString(xml, 'application/xml');
}

/* ---------- the DOM walk ---------- */

export type BlockKind = 'heading' | 'bullet' | 'body' | 'cell' | 'tabbed';

/**
 * One paragraph of the document with the lines it renders to (marker
 * included on the first line, exactly as the text shows them) and the node
 * behind it. A table cell's paragraphs are `cell` blocks carrying their row
 * and cell index; the fold joins a row's cells with " | " and a cell's
 * paragraphs with a space, the way an ATS parser flattens a table.
 */
export interface Block {
  kind: BlockKind;
  node: Element;
  lines: string[];
  /** The marker the reader wrote before line 0 ("- ", "## ", "# "), '' when none — never text the file itself holds. */
  marker: string;
  table?: { row: number; cell: number };
}

/** Every paragraph of the body in document order, tables flattened to `cell` blocks. */
export function walkDocument(doc: Document): Block[] {
  const body = doc.getElementsByTagNameNS(W_NS, 'body').item(0) ?? doc.documentElement;
  if (!body) return [];
  const blocks: Block[] = [];
  walkChildren(body, blocks);
  return blocks;
}

/**
 * The regex reader scanned the XML string linearly, so it found paragraphs at
 * any depth — inside content controls, smart tags, tracked changes. The walk
 * descends the same way: a table is a table, a paragraph is a paragraph, and
 * anything else is looked into.
 */
function walkChildren(parent: Node, blocks: Block[]): void {
  for (const child of children(parent)) {
    if (isW(child, 'tbl')) {
      walkTable(child, blocks);
    } else if (isW(child, 'p')) {
      blocks.push(paragraphBlock(child));
    } else {
      walkChildren(child, blocks);
    }
  }
}

function walkTable(table: Element, blocks: Block[]): void {
  let row = 0;
  for (const tr of descendantsUntil(table, 'tr', 'tbl')) {
    let cell = 0;
    for (const tc of descendantsUntil(tr, 'tc', 'tbl')) {
      const inner: Block[] = [];
      walkChildren(tc, inner);
      for (const b of inner) blocks.push({ ...b, kind: b.table ? b.kind : 'cell', table: b.table ?? { row, cell } });
      cell++;
    }
    row++;
  }
  // A table ends with a blank line, as the regex reader wrote one after every table.
  blocks.push({ kind: 'body', node: table, lines: [''], marker: '', table: { row: -1, cell: -1 } });
}

/** Elements named `name` under `root`, not descending into a nested `stop` element (a table inside a cell is its own table). */
function descendantsUntil(root: Element, name: string, stop: string): Element[] {
  const out: Element[] = [];
  const visit = (n: Node) => {
    for (const c of children(n)) {
      if (isW(c, name)) out.push(c);
      else if (!isW(c, stop)) visit(c);
    }
  };
  visit(root);
  return out;
}

/**
 * The marker the reader writes before a paragraph's text: "- " for a list
 * item, "# " for the Title style, "## " for a heading style or a line that
 * looks like one, nothing otherwise. The patcher asks the same question of a
 * line it writes, so its read-back gate expects what the reader will say.
 */
export function markerFor(p: Element, text: string): string {
  return styleMarker(p) || (looksLikeHeading(text) ? '## ' : '');
}

/** The marker a paragraph earns by its properties alone — a list item, the Title style, a heading style. */
export function styleMarker(p: Element): string {
  const props = children(p).find((c) => isW(c, 'pPr'));
  const isListItem = props ? descendantsUntil(props, 'numPr', 'p').length > 0 : false;
  const style = props ? (descendantsUntil(props, 'pStyle', 'p')[0]?.getAttribute('w:val') ?? '') : '';
  if (isListItem) return '- ';
  if (/^Title$/i.test(style)) return '# ';
  if (/^Heading/i.test(style)) return '## ';
  return '';
}

function paragraphBlock(p: Element): Block {
  let raw = '';
  let tabbed = false;
  const visit = (n: Node) => {
    for (const c of children(n)) {
      if (isW(c, 'pPr')) continue;
      if (isW(c, 't') || (c.namespaceURI === M_NS && c.localName === 't')) raw += c.textContent ?? '';
      else if (isW(c, 'tab')) { raw += '\t'; tabbed = true; }
      else if (isW(c, 'br') || isW(c, 'cr')) raw += '\n';
      else visit(c);
    }
  };
  visit(p);

  const lines = raw
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]*\t[ \t]*/g, ' | ').replace(/ {2,}/g, ' ').trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return { kind: 'body', node: p, lines: [''], marker: '' };

  const text = lines.join('\n');
  const marker = markerFor(p, text);
  const kind: BlockKind = marker === '- ' ? 'bullet' : marker ? 'heading' : tabbed ? 'tabbed' : 'body';
  return { kind, node: p, lines: `${marker}${text}`.split('\n'), marker };
}

/**
 * Who owns a rendered line: a paragraph block and which of its lines, a
 * table row (the cell paragraphs whose text was joined into it), or nobody —
 * a blank line or a table's trailing gap. The patcher maps an edit back
 * through this; the text path only needs the strings.
 */
export type LineOwner =
  | { kind: 'paragraph'; block: Block; line: number }
  | { kind: 'row'; blocks: Block[] }
  | null;

/**
 * The lines the blocks render to, one owner each — the same strings the regex
 * reader produced. A table row joins each cell's paragraphs with a space and
 * the cells with " | "; a paragraph's rendered string keeps its soft breaks,
 * so a row whose cell has one splits over two lines. That is how the regex
 * reader always did it and how every stored resume text reads, and the
 * patcher's gate compares against exactly that text.
 */
export function renderLines(blocks: Block[]): { lines: string[]; owners: LineOwner[] } {
  const lines: string[] = [];
  const owners: LineOwner[] = [];
  const push = (text: string, owner: LineOwner) => {
    for (const line of text.split('\n')) {
      lines.push(line);
      owners.push(line.length === 0 ? null : owner);
    }
  };
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i]!;
    if (!b.table || b.table.row < 0) {
      b.lines.forEach((line, n) => { lines.push(line); owners.push(line.length === 0 ? null : { kind: 'paragraph', block: b, line: n }); });
      i++;
      continue;
    }
    const row = b.table.row;
    const cells = new Map<number, string[]>();
    const members: Block[] = [];
    while (i < blocks.length && blocks[i]!.table && blocks[i]!.table!.row === row) {
      const cb = blocks[i]!;
      if (cb.lines.some((l) => l.length > 0)) {
        (cells.get(cb.table!.cell) ?? cells.set(cb.table!.cell, []).get(cb.table!.cell)!).push(cb.lines.join('\n'));
        members.push(cb);
      }
      i++;
    }
    const rendered = [...cells.values()].map((paragraphs) => paragraphs.join(' ')).filter((t) => t.length > 0);
    if (rendered.length > 0) push(rendered.join(' | '), { kind: 'row', blocks: members });
  }
  return { lines, owners };
}

/** The text the blocks render to — the same string the regex reader produced. */
export function blocksToText(blocks: Block[]): string {
  return foldLines(renderLines(blocks).lines);
}

function foldLines(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function children(n: Node): Element[] {
  const out: Element[] = [];
  const list = n.childNodes;
  for (let i = 0; i < list.length; i++) {
    const c = list.item(i);
    if (c && c.nodeType === 1) out.push(c as Element);
  }
  return out;
}

function isW(n: Element, name: string): boolean {
  return n.namespaceURI === W_NS && n.localName === name;
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

/* ---------- the regex reader, kept as the fallback ---------- */

function bodyOf(xml: string): string {
  return /<w:body>([\s\S]*?)<\/w:body>/.exec(xml)?.[1] ?? xml;
}

const BLOCK_RE = /<w:(tbl|p)(?=[\s>/])/g;
const TABLE_BOUNDARY_RE = /<w:tbl(?=[\s>])|<\/w:tbl>/g;
const ROW_RE = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
const CELL_RE = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
const RUN_TOKEN_RE =
  /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<m:t(?:\s[^>]*)?>([^<]*)<\/m:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g;

function regexRenderBlocks(xml: string): string[] {
  const out: string[] = [];
  const re = new RegExp(BLOCK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const start = m.index;
    if (m[1] === 'tbl') {
      const end = findTableEnd(xml, start);
      out.push(...regexRenderTable(xml.slice(start, end)), '');
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
    out.push(regexRenderParagraph(xml.slice(start, end)));
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

function regexRenderTable(tableXml: string): string[] {
  const rows: string[] = [];
  for (const row of tableXml.matchAll(ROW_RE)) {
    const cells: string[] = [];
    for (const cell of (row[1] ?? '').matchAll(CELL_RE)) {
      const text = regexRenderBlocks(cell[1] ?? '')
        .filter((line) => line.length > 0)
        .join(' ');
      if (text.length > 0) cells.push(text);
    }
    if (cells.length > 0) rows.push(cells.join(' | '));
  }
  return rows;
}

function regexRenderParagraph(paragraphXml: string): string {
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
    .replace(/\u00a0/g, ' ')
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

/** The regex reader on its own — exported for the parity test only. */
export function regexDocumentXmlToText(xml: string): string {
  return foldLines(regexRenderBlocks(bodyOf(xml)));
}
