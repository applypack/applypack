/*
 * Write the editor's text back into the user's own .docx (ADR 0038). Pure:
 * bytes and two texts in, bytes and a report out, nothing touched on disk.
 *
 * The contract is narrow on purpose. The analysed text must be exactly what
 * this file renders to — otherwise the edits describe some other version and
 * nothing is written. Every edit is a line diff (the same diffLines the
 * change sheet uses) mapped back to the paragraph that rendered the line;
 * a changed line is written into that paragraph's runs, a deleted line takes
 * its paragraph out, an inserted line clones the paragraph above it. What
 * cannot be mapped honestly — a table row, a line inside a text box, a
 * paragraph whose tab layout the edit changed — is refused with a reason,
 * and in v1 one refusal fails the whole save: a half-patched file is worse
 * than a text version.
 *
 * Every other part of the archive is carried over byte for byte; only
 * word/document.xml and docProps/core.xml are rewritten (pre-work note:
 * xmldom reproduces the document part to the byte, jszip the rest).
 */

import JSZip from 'jszip';
import { XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element } from '@xmldom/xmldom';
import { docxToText, parseDocumentXml, renderLines, walkDocument, W_NS, type Block, type LineOwner } from './docx-text';
import { setCoreProps } from './docx-props';
import { loadLineDiff, type DiffOp } from './line-diff';
import { toPlainPunctuation } from './prompts';

export interface PatchReport {
  changed: number;
  removed: number;
  added: number;
  skipped: { line: string; reason: string }[];
  /** When the read-back gate refuses: the first line that differs, in full, for the log. */
  readback?: { line: number; got: string; wanted: string };
}

export type PatchResult =
  | { ok: true; docx: Buffer; report: PatchReport; text: string }
  | { ok: false; reason: string; report?: PatchReport };

export interface PatchOptions {
  /** Rewrite the document properties too (title, creator, last modified by) — the opt-in "fix" (docx-props.ts). */
  fixProperties?: { title: string; author: string };
  now?: Date;
}

const DOCUMENT_PART = 'word/document.xml';
const CORE_PART = 'docProps/core.xml';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
/** The renderer's markers, stripped from an edited line before it is written back. */
const MARKER = /^(?:- |## |# )/;
const CELL_JOIN = ' | ';

export async function patchDocx(
  original: Buffer,
  analysedText: string,
  editedText: string,
  opts: PatchOptions = {},
): Promise<PatchResult> {
  const zip = await JSZip.loadAsync(original);
  const part = zip.file(DOCUMENT_PART);
  if (!part) return { ok: false, reason: 'not a .docx file (word/document.xml missing)' };
  const xml = await part.async('string');
  let doc: Document;
  try {
    doc = parseDocumentXml(xml);
  } catch {
    return { ok: false, reason: 'the document XML could not be parsed' };
  }

  const blocks = walkDocument(doc);
  const folded = fold(renderLines(blocks));
  const analysed = normalise(analysedText);
  if (folded.lines.join('\n') !== analysed) {
    return { ok: false, reason: 'the analysed text does not match this file — the edits describe another version' };
  }

  const { diffLines } = await loadLineDiff();
  const ops = diffLines(analysed, normalise(editedText));
  const report: PatchReport = { changed: 0, removed: 0, added: 0, skipped: [] };
  const expected: string[] = [];
  const skip = (line: string, reason: string) => report.skipped.push({ line, reason });

  // Every op resolves to a node BEFORE anything is mutated, so a delete above
  // an insert cannot pull the insert's anchor out from under it.
  const plan: Array<() => void> = [];
  const lastInserted = new Map<Element, Element>();
  let lastOwner: LineOwner = null;
  for (const op of ops) {
    if (op.op === 'keep') {
      expected.push(op.a.text);
      lastOwner = folded.owners[op.a.i] ?? null;
      continue;
    }
    if (op.op === 'change') {
      const owner = folded.owners[op.a.i] ?? null;
      const text = toPlainPunctuation(op.b.text);
      const paragraph = owner?.kind === 'paragraph' ? owner : null;
      if (!paragraph) { skip(op.a.text, owner?.kind === 'row' ? 'a table row cannot be rewritten as one line' : 'no paragraph behind this line'); expected.push(op.a.text); continue; }
      const write = planChange(paragraph.block, paragraph.line, op.a.text, text);
      if (typeof write === 'string') { skip(op.a.text, write); expected.push(op.a.text); continue; }
      plan.push(write);
      report.changed++;
      expected.push(text);
      lastOwner = owner;
      continue;
    }
    if (op.op === 'delete') {
      const owner = folded.owners[op.a.i] ?? null;
      const reason = deleteReason(owner);
      if (reason) { skip(op.a.text, reason); expected.push(op.a.text); continue; }
      const node = (owner as { block: Block }).block.node;
      plan.push(() => node.parentNode?.removeChild(node));
      report.removed++;
      continue;
    }
    // insert
    const text = toPlainPunctuation(op.b.text);
    const anchor = lastOwner?.kind === 'paragraph' ? lastOwner.block : null;
    if (!anchor) { skip(op.b.text, lastOwner?.kind === 'row' ? 'cannot add a line inside a table' : 'no paragraph above this line to shape it after'); continue; }
    if (anchor.table) { skip(op.b.text, 'cannot add a line inside a table'); continue; }
    if (boxed(anchor.node)) { skip(op.b.text, 'cannot add a line inside a text box'); continue; }
    const cloneAfter = anchor.node;
    plan.push(() => insertAfter(doc, cloneAfter, anchor, text, lastInserted));
    report.added++;
    expected.push(text);
    // Later inserts follow this one, not the paragraph above it: keep the
    // anchor and let insertAfter place each clone after the previous clone.
  }

  if (report.skipped.length > 0) {
    return { ok: false, reason: `${report.skipped.length} line${report.skipped.length === 1 ? '' : 's'} could not be written back: ${report.skipped[0]!.reason}`, report };
  }
  for (const step of plan) step();

  // Serialise; give the declaration its CRLF back when Word wrote one.
  let out = new XMLSerializer().serializeToString(doc);
  if (/^<\?xml[^>]*\?>\r\n/.test(xml)) out = out.replace(/^(<\?xml[^>]*\?>)\n/, '$1\r\n');
  zip.file(DOCUMENT_PART, out);
  const core = zip.file(CORE_PART);
  const now = opts.now ?? new Date();
  const props = opts.fixProperties
    ? { title: opts.fixProperties.title, creator: opts.fixProperties.author, lastModifiedBy: opts.fixProperties.author }
    : {};
  zip.file(CORE_PART, setCoreProps(core ? await core.async('string') : null, props, now));
  const docx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  // The gates: what the file now reads as must be exactly the edit, and
  // nothing the patcher never touches may have moved.
  const text = docxToText(docx);
  const wanted = foldText(expected);
  if (text !== wanted) {
    const diff = firstDifference(text, wanted);
    return { ok: false, reason: `the patched file does not read back as the edited text (line ${diff.line} reads ${JSON.stringify(diff.got.slice(0, 60))}, expected ${JSON.stringify(diff.wanted.slice(0, 60))})`, report: { ...report, readback: diff } };
  }
  for (const [name, ns] of [['oMath', M_NS], ['drawing', W_NS], ['txbxContent', W_NS], ['vanish', W_NS]] as const) {
    const before = countIn(xml, name);
    const after = countIn(out, name);
    if (before !== after) return { ok: false, reason: `the patch would change the number of ${name} objects (${before} → ${after})`, report };
  }
  return { ok: true, docx, report, text };
}

/* ---------- planning one change ---------- */

/**
 * Plan writing `next` where rendered line `line` of `block` was. Returns the
 * step to run, or the reason it cannot be done. The paragraph's runs are read
 * as tab groups; the new line is split the same way, so each side of a
 * `Company | Location` header lands in its own runs.
 */
function planChange(block: Block, line: number, prev: string, next: string): (() => void) | string {
  if (boxed(block.node)) return 'text inside a text box is not edited in place';
  const marker = MARKER.exec(prev)?.[0] ?? '';
  const body = next.startsWith(marker) ? next.slice(marker.length) : next;
  const segments = segmentsOf(block.node);
  const segment = segments[line];
  if (!segment) return 'the line and its paragraph no longer line up';
  const parts = body.split(CELL_JOIN);
  if (parts.length !== segment.groups.length) return 'the edit changes the tab layout of this line';
  const writes: Array<() => void> = [];
  segment.groups.forEach((group, g) => {
    const wanted = parts[g]!.trim();
    if (renderedOf(group) === wanted) return;
    writes.push(() => writeGroup(group, wanted));
  });
  return () => writes.forEach((w) => w());
}

/** A run of text nodes between two tabs, in one line of a paragraph. */
interface Group {
  texts: Element[];
}
interface Segment {
  groups: Group[];
}

/** The paragraph's text nodes split by soft breaks into lines and by tabs into groups, in document order. */
function segmentsOf(p: Element): Segment[] {
  const segments: Segment[] = [{ groups: [{ texts: [] }] }];
  const visit = (n: Element) => {
    for (const c of children(n)) {
      if (isW(c, 'pPr')) continue;
      if (isW(c, 't') || (c.namespaceURI === M_NS && c.localName === 't')) segments[segments.length - 1]!.groups.at(-1)!.texts.push(c);
      else if (isW(c, 'tab')) segments[segments.length - 1]!.groups.push({ texts: [] });
      else if (isW(c, 'br') || isW(c, 'cr')) segments.push({ groups: [{ texts: [] }] });
      else visit(c);
    }
  };
  visit(p);
  // A line the renderer dropped as empty owns no rendered index, so drop it here too.
  return segments.filter((s) => s.groups.some((g) => renderedOf(g).length > 0));
}

function rawOf(group: Group): string {
  return group.texts.map((t) => t.textContent ?? '').join('');
}

/** What the renderer made of this group: the same normalisation docx-text applies to a line. */
function renderedOf(group: Group): string {
  return rawOf(group).replace(/\u00a0/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * Put `wanted` into the group's runs. When the raw text is what the renderer
 * showed, only the changed window is rewritten, so a bold fragment outside
 * the edit keeps its run; otherwise the first run takes the whole new text
 * and the rest are emptied. `xml:space="preserve"` on every node written,
 * because 235 of resume 1's 432 text nodes lack it and a space at either
 * edge would otherwise vanish.
 */
function writeGroup(group: Group, wanted: string): void {
  const raw = rawOf(group);
  const texts = group.texts;
  if (texts.length === 0) return;
  if (raw !== renderedOf(group) || texts.length === 1) {
    setText(texts[0]!, wanted);
    for (const t of texts.slice(1)) setText(t, '');
    return;
  }
  let head = 0;
  while (head < raw.length && head < wanted.length && raw[head] === wanted[head]) head++;
  let tail = 0;
  while (tail < raw.length - head && tail < wanted.length - head && raw[raw.length - 1 - tail] === wanted[wanted.length - 1 - tail]) tail++;
  const middle = wanted.slice(head, wanted.length - tail);
  // The window [winStart, winEnd) of raw that changes. It can be empty — a pure
  // insertion — and then it belongs to the run that ends on that boundary:
  // resume 1 keeps a bullet's final "." in a run of its own, and an insertion
  // before it must not fall between two runs and land nowhere.
  const winStart = head;
  const winEnd = raw.length - tail;
  let offset = 0;
  let placed = false;
  for (const t of texts) {
    const text = t.textContent ?? '';
    const start = offset;
    const end = offset + text.length;
    offset = end;
    const overlaps = start < winEnd && end > winStart;
    const boundary = !placed && winStart === winEnd && start <= winStart && end >= winStart;
    if (!overlaps && !boundary) continue;
    const keepHead = text.slice(0, Math.min(text.length, Math.max(0, winStart - start)));
    const keepTail = text.slice(Math.min(text.length, Math.max(0, winEnd - start)));
    setText(t, keepHead + (placed ? '' : middle) + keepTail);
    placed = true;
  }
  if (!placed) {
    setText(texts[0]!, wanted);
    for (const t of texts.slice(1)) setText(t, '');
  }
}

function setText(t: Element, value: string): void {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument!.createTextNode(value));
  t.setAttribute('xml:space', 'preserve');
}

/* ---------- deletes and inserts ---------- */

function deleteReason(owner: LineOwner): string | null {
  if (!owner) return 'no paragraph behind this line';
  if (owner.kind === 'row') return 'a table row cannot be removed';
  if (owner.block.table) return 'a table cell cannot be removed';
  if (boxed(owner.block.node)) return 'text inside a text box is not edited in place';
  if (owner.block.lines.length > 1) return 'this line shares its paragraph with the next one';
  return null;
}

/**
 * A new paragraph after `after`, shaped like `anchor`: its paragraph
 * properties (so a bullet after a bullet stays in the list) and the first
 * run's character properties, with one run holding the text.
 */
function insertAfter(doc: Document, after: Element, anchor: Block, text: string, lastInserted: Map<Element, Element>): void {
  const clone = anchor.node.cloneNode(true) as Element;
  const rPr = firstRunProps(anchor.node);
  for (const c of children(clone)) if (!isW(c, 'pPr')) clone.removeChild(c);
  const run = doc.createElementNS(W_NS, 'w:r');
  if (rPr) run.appendChild(rPr.cloneNode(true));
  const t = doc.createElementNS(W_NS, 'w:t');
  run.appendChild(t);
  clone.appendChild(run);
  const marker = anchor.kind === 'bullet' ? /^- / : MARKER;
  setText(t, text.replace(marker, ''));
  // Each clone goes after the last one, so a run of inserts keeps its order.
  const at = lastInserted.get(after) ?? after;
  at.parentNode!.insertBefore(clone, at.nextSibling);
  lastInserted.set(after, clone);
}

function firstRunProps(p: Element): Element | null {
  for (const c of children(p)) {
    if (isW(c, 'r')) return children(c).find((x) => isW(x, 'rPr')) ?? null;
    if (!isW(c, 'pPr')) { const inner = firstRunProps(c); if (inner) return inner; }
  }
  return null;
}

/* ---------- folding the rendered lines the way the text reader does ---------- */

/**
 * docx-text folds its rendered lines (trailing blanks stripped, ≥ 3 blank
 * lines collapsed to 2, edges trimmed). The diff runs on the folded text, so
 * the owners must be folded the same way or line indexes drift.
 */
function fold(rendered: { lines: string[]; owners: LineOwner[] }): { lines: string[]; owners: LineOwner[] } {
  const lines: string[] = [];
  const owners: LineOwner[] = [];
  let blanks = 0;
  rendered.lines.forEach((raw, i) => {
    const line = raw.replace(/[ \t]+$/, '');
    if (line.length === 0) {
      blanks++;
      if (blanks > 1 || lines.length === 0) return;
    } else blanks = 0;
    lines.push(line);
    owners.push(line.length === 0 ? null : (rendered.owners[i] ?? null));
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') { lines.pop(); owners.pop(); }
  return { lines, owners };
}

function foldText(lines: string[]): string {
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalise(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- small DOM helpers ---------- */

function children(n: Element): Element[] {
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

function boxed(p: Element): boolean {
  return p.getElementsByTagNameNS(W_NS, 'txbxContent').length > 0;
}

/** Where two texts part ways: the first line that differs, both versions in full. */
function firstDifference(got: string, wanted: string): { line: number; got: string; wanted: string } {
  const a = got.split('\n');
  const b = wanted.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { line: i + 1, got: a[i] ?? '', wanted: b[i] ?? '' };
  }
  return { line: 0, got, wanted };
}

function countIn(xml: string, name: string): number {
  return (xml.match(new RegExp(`<(?:w|m):${name}(?=[\\s>/])`, 'g')) ?? []).length;
}

export type { DiffOp };
