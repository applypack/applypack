/*
 * The template check (ADR 0038): what a .docx is made of, and therefore how
 * much of it a Save can write back in place. Pure — bytes in, a verdict and
 * plain sentences out. Runs at upload and again on every page that needs it;
 * nothing is stored, because 40 KB of XML is a sub-millisecond read.
 *
 * The three populations the plan named: a flow document (paragraphs, patched
 * fully), a structural one (tables, text boxes, columns, a header — patched
 * where a paragraph can be found, said plainly where it cannot), and one the
 * patcher must not touch at all.
 */

import type { Document, Element } from '@xmldom/xmldom';
import { parseDocumentXml, walkDocument, W_NS, type Block } from './docx-text';
import { readZipEntry } from './zip';
import { t } from '../i18n/t';

export type DocxKind = 'flow' | 'structural' | 'unsupported';

export interface DocxStructure {
  kind: DocxKind;
  /** Rendered text lines, and how many of them a paragraph or a table cell owns — the ones Save can rewrite. */
  lines: { total: number; editable: number };
  tables: number;
  textBoxes: number;
  drawings: number;
  columns: number;
  headerChars: number;
  footerChars: number;
  math: number;
  hiddenRuns: number;
  whiteRuns: number;
  tinyRuns: number;
  /** Plain sentences for the card, in the order they matter. */
  notes: string[];
}

const DOCUMENT_PART = 'word/document.xml';
const RELS_PART = 'word/_rels/document.xml.rels';
/** Half-points: 8 = 4 pt, the size below which text is there to be indexed, not read. */
const TINY_HALF_POINTS = 8;
const WHITE = /^(?:ffffff|white)$/i;

export function docxStructure(bytes: Buffer): DocxStructure {
  const empty: DocxStructure = {
    kind: 'unsupported',
    lines: { total: 0, editable: 0 },
    tables: 0, textBoxes: 0, drawings: 0, columns: 1,
    headerChars: 0, footerChars: 0, math: 0,
    hiddenRuns: 0, whiteRuns: 0, tinyRuns: 0,
    notes: [],
  };
  const part = readZipEntry(bytes, DOCUMENT_PART);
  if (part === null) return { ...empty, notes: [t('resume.structure.note.notDocx')] };
  let doc: Document;
  try {
    doc = parseDocumentXml(part.toString('utf8'));
  } catch {
    return { ...empty, notes: [t('resume.structure.note.unparsed')] };
  }

  const count = (ns: string, name: string) => doc.getElementsByTagNameNS(ns, name).length;
  const runProps = (name: string) => doc.getElementsByTagNameNS(W_NS, name);
  const tables = count(W_NS, 'tbl');
  const textBoxes = count(W_NS, 'txbxContent');
  // A VML picture that is not a text box, plus every DrawingML object.
  const drawings = count(W_NS, 'drawing') + [...elements(doc, 'pict')].filter((p) => p.getElementsByTagNameNS(W_NS, 'txbxContent').length === 0).length;
  const columns = [...elements(doc, 'cols')].reduce((n, c) => Math.max(n, Number(c.getAttribute('w:num') ?? 1) || 1), 1);
  const math = count('http://schemas.openxmlformats.org/officeDocument/2006/math', 'oMath');
  const hiddenRuns = runProps('vanish').length;
  const whiteRuns = [...elements(doc, 'color')].filter((c) => WHITE.test(c.getAttribute('w:val') ?? '')).length;
  const tinyRuns = [...elements(doc, 'sz')].filter((s) => Number(s.getAttribute('w:val')) <= TINY_HALF_POINTS).length;

  const { headerChars, footerChars } = marginChars(bytes);
  const blocks = walkDocument(doc);
  const textLines = (b: Block) => b.lines.filter((l) => l.length > 0).length;
  const total = blocks.reduce((n, b) => n + textLines(b), 0);
  const boxed = blocks.filter((b) => b.node.getElementsByTagNameNS(W_NS, 'txbxContent').length > 0);
  const editable = total - boxed.reduce((n, b) => n + textLines(b), 0);
  const boxedChars = boxed.reduce((n, b) => n + b.lines.join('').length, 0);
  const bodyChars = blocks.reduce((n, b) => n + b.lines.join('').length, 0) - boxedChars;

  const notes: string[] = [];
  if (headerChars > 0) notes.push(t('resume.structure.note.header'));
  if (footerChars > 0) notes.push(t('resume.structure.note.footer'));
  if (tables > 0) notes.push(t('resume.structure.note.tables', { n: tables }));
  if (textBoxes > 0) notes.push(t('resume.structure.note.textBoxes', { n: textBoxes }));
  if (columns > 1) notes.push(t('resume.structure.note.columns', { n: columns }));
  if (math > 0) notes.push(t('resume.structure.note.math', { n: math }));
  if (drawings > 0) notes.push(t('resume.structure.note.drawings', { n: drawings }));
  if (hiddenRuns > 0) notes.push(t('resume.structure.note.hiddenRuns', { n: hiddenRuns }));
  if (whiteRuns > 0) notes.push(t('resume.structure.note.whiteRuns', { n: whiteRuns }));
  if (tinyRuns > 0) notes.push(t('resume.structure.note.tinyRuns', { n: tinyRuns }));

  const kind: DocxKind =
    total === 0 || boxedChars > bodyChars
      ? 'unsupported'
      : tables === 0 && textBoxes === 0 && columns <= 1 && headerChars === 0 && footerChars === 0
        ? 'flow'
        : 'structural';
  if (kind === 'unsupported' && total > 0) notes.unshift(t('resume.structure.note.boxed'));

  return { kind, lines: { total, editable }, tables, textBoxes, drawings, columns, headerChars, footerChars, math, hiddenRuns, whiteRuns, tinyRuns, notes };
}

function* elements(doc: Document, name: string): Iterable<Element> {
  const list = doc.getElementsByTagNameNS(W_NS, name);
  for (let i = 0; i < list.length; i++) yield list.item(i)!;
}

/** Text in the header and footer parts the document's relationships point at. */
function marginChars(bytes: Buffer): { headerChars: number; footerChars: number } {
  const rels = readZipEntry(bytes, RELS_PART)?.toString('utf8') ?? '';
  let headerChars = 0;
  let footerChars = 0;
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const tag = m[0];
    const type = /Type="[^"]*\/(header|footer)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    if (!type || !target) continue;
    const part = readZipEntry(bytes, target.startsWith('/') ? target.slice(1) : `word/${target}`);
    if (!part) continue;
    const chars = [...part.toString('utf8').matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].reduce((n, t) => n + (t[1] ?? '').trim().length, 0);
    if (type === 'header') headerChars += chars;
    else footerChars += chars;
  }
  return { headerChars, footerChars };
}

/**
 * The one-line verdict. Above the editor it carries the first note, because
 * that line is all the page says; on the card the notes are listed under it,
 * so `withNote: false` keeps the line short.
 */
export function describeStructure(s: DocxStructure, opts: { withNote?: boolean } = {}): string {
  if (s.kind === 'unsupported') return t('resume.structure.unsupported');
  const lines = { editable: s.lines.editable, total: s.lines.total };
  if (s.kind === 'flow') return t('resume.structure.flow', lines);
  if (opts.withNote === false) return t('resume.structure.partly', lines);
  // The note ends the sentence: it brings its own full stop.
  return t('resume.structure.partlyNote', { ...lines, note: s.notes[0] ?? t('resume.structure.notParagraphs') });
}
