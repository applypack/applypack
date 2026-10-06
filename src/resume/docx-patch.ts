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
import { docxToText, markerFor, parseDocumentXml, renderLines, styleMarker, walkDocument, W_NS, type Block, type LineOwner } from './docx-text';
import { setCoreProps } from './docx-props';
import { loadLineDiff } from './line-diff';
import { readZipEntry, ZipError } from './zip';
import { toPlainPunctuation } from './prompts';
import type { MessageKey } from '../i18n/catalog';
import { SOURCE_LOCALE, withLocale } from '../i18n/locale';
// A `t` in this file is a <w:t> element, so the catalog's reader comes in under another name.
import { t as say } from '../i18n/t';

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
  | PatchRefusal;

/**
 * `reason` is English whatever the page's language: the log keeps it and
 * draft-document.ts reads it. `shown` is the same sentence for the person.
 */
interface PatchRefusal {
  ok: false;
  reason: string;
  shown: string;
  report?: PatchReport;
}

/** Why one line cannot be written back, as the catalog key of the sentence that says so. */
type LineRefusal = Extract<MessageKey, `resume.patch.line.${string}`>;

const inEnglish = (words: () => string): string => withLocale(SOURCE_LOCALE, words);

function refusal(words: () => string, report?: PatchReport): PatchRefusal {
  return { ok: false, reason: inEnglish(words), shown: words(), ...(report ? { report } : {}) };
}

export interface PatchOptions {
  /** Rewrite the document properties too (title, creator, last modified by) — the opt-in "fix" (docx-props.ts). */
  fixProperties?: { title: string; author: string };
  now?: Date;
}

const DOCUMENT_PART = 'word/document.xml';
const CORE_PART = 'docProps/core.xml';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const CELL_JOIN = ' | ';

export async function patchDocx(
  original: Buffer,
  analysedText: string,
  editedText: string,
  opts: PatchOptions = {},
): Promise<PatchResult> {
  // Read the part through zip.ts, which applies the project's inflation cap.
  // JSZip has no ceiling of its own, so a zip bomb uploaded as a
  // resume would have inflated here — the reader that checks it is the one
  // the rest of the module already uses. JSZip stays for the rewrite only.
  let xml: string;
  try {
    const part = readZipEntry(original, DOCUMENT_PART);
    if (!part) return refusal(() => say('resume.patch.notDocx'));
    xml = part.toString('utf8');
  } catch (err) {
    if (err instanceof ZipError) return refusal(() => say('resume.patch.unsafe'));
    throw err;
  }
  const zip = await JSZip.loadAsync(original, { createFolders: false });
  let doc: Document;
  try {
    doc = parseDocumentXml(xml);
  } catch {
    return refusal(() => say('resume.patch.unparsed'));
  }

  const blocks = walkDocument(doc);
  const folded = fold(renderLines(blocks));
  const analysed = normalise(analysedText);
  if (folded.lines.join('\n') !== analysed) {
    return refusal(() => say('resume.patch.stale'));
  }

  const { diffLines } = await loadLineDiff();
  const ops = diffLines(analysed, normalise(editedText));
  const report: PatchReport = { changed: 0, removed: 0, added: 0, skipped: [] };
  const expected: string[] = [];
  // The report is for the log, so its reasons are English; the first refusal is also said to the person.
  let firstRefused: LineRefusal | null = null;
  const skip = (line: string, why: LineRefusal) => {
    firstRefused ??= why;
    report.skipped.push({ line, reason: inEnglish(() => say(why)) });
  };

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
      if (owner?.kind === 'row') {
        const row = planRowChange(owner.blocks, op.a.text, text);
        if (typeof row === 'string') { skip(op.a.text, row); expected.push(op.a.text); continue; }
        plan.push(row.write);
        report.changed++;
        expected.push(row.readBack);
        lastOwner = owner;
        continue;
      }
      const paragraph = owner?.kind === 'paragraph' ? owner : null;
      if (!paragraph) { skip(op.a.text, 'resume.patch.line.noParagraph'); expected.push(op.a.text); continue; }
      const write = planChange(paragraph.block, paragraph.line, op.a.text, text);
      if (typeof write === 'string') { skip(op.a.text, write); expected.push(op.a.text); continue; }
      plan.push(write);
      report.changed++;
      expected.push(readBack(paragraph.block, op.a.text, text));
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
    if (!anchor) { skip(op.b.text, lastOwner?.kind === 'row' ? 'resume.patch.line.addInTable' : 'resume.patch.line.noAnchor'); continue; }
    if (anchor.table) { skip(op.b.text, 'resume.patch.line.addInTable'); continue; }
    if (boxed(anchor.node)) { skip(op.b.text, 'resume.patch.line.addInTextBox'); continue; }
    const cloneAfter = anchor.node;
    plan.push(() => insertAfter(doc, cloneAfter, anchor, text, lastInserted));
    report.added++;
    const body = insertedBody(anchor, text);
    expected.push(markerFor(anchor.node, body) + body);
    // Later inserts follow this one, not the paragraph above it: keep the
    // anchor and let insertAfter place each clone after the previous clone.
  }

  if (firstRefused) {
    const first: LineRefusal = firstRefused;
    return refusal(() => say('resume.patch.skipped', { n: report.skipped.length, reason: say(first) }), report);
  }
  for (const step of plan) step();

  // Serialise; give the declaration its CRLF back when Word wrote one.
  let out = new XMLSerializer().serializeToString(doc);
  if (/^<\?xml[^>]*\?>\r\n/.test(xml)) out = out.replace(/^(<\?xml[^>]*\?>)\n/, '$1\r\n');
  zip.file(DOCUMENT_PART, out, { createFolders: false });
  // Stamp the properties part when the package has one; never add a part.
  const core = zip.file(CORE_PART);
  if (core) {
    const props = opts.fixProperties
      ? { title: opts.fixProperties.title, creator: opts.fixProperties.author, lastModifiedBy: opts.fixProperties.author }
      : {};
    zip.file(CORE_PART, setCoreProps(await core.async('string'), props, opts.now ?? new Date()), { createFolders: false });
  }
  const docx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  // The gates: what the file now reads as must be exactly the edit, and
  // nothing the patcher never touches may have moved.
  const text = docxToText(docx);
  const wanted = foldText(expected);
  if (text !== wanted) {
    const diff = firstDifference(text, wanted);
    const said = { line: diff.line, got: JSON.stringify(diff.got.slice(0, 60)), wanted: JSON.stringify(diff.wanted.slice(0, 60)) };
    return refusal(() => say('resume.patch.readback', said), { ...report, readback: diff });
  }
  for (const [name, ns] of [['oMath', M_NS], ['drawing', W_NS], ['txbxContent', W_NS], ['vanish', W_NS]] as const) {
    const before = countIn(xml, name);
    const after = countIn(out, name);
    if (before !== after) return refusal(() => say('resume.patch.objects', { name, before, after }), report);
  }
  return { ok: true, docx, report, text };
}

/**
 * What the reader will make of a one-line paragraph once `next` is written
 * into it: its words, behind the marker the paragraph's own style and look
 * earn. A body line cut down to "AWS, S3, EC2" reads back as a heading, and
 * the gate must expect that rather than refuse a correct file.
 */
function readBack(block: Block, prev: string, next: string): string {
  if (block.lines.length !== 1) return next;
  const body = withoutMarker(block, 0, prev, next);
  return markerFor(block.node, body) + body;
}

/**
 * The words to write for rendered line `line` of `block`: `next` without the
 * marker the READER put in front of `prev` — never a "- " or "# " the file's
 * own text carries, which is words like any other (the reviewer's case: a
 * plain paragraph typed "- Did the first thing well").
 */
function withoutMarker(block: Block, line: number, prev: string, next: string): string {
  const marker = line === 0 ? block.marker : '';
  return marker && prev.startsWith(marker) && next.startsWith(marker) ? next.slice(marker.length) : next;
}

/** A new line's words, without the marker its paragraph's properties will earn it anyway. */
function insertedBody(anchor: Block, text: string): string {
  const marker = styleMarker(anchor.node);
  return marker && text.startsWith(marker) ? text.slice(marker.length) : text;
}

/**
 * A table row's line ("Programming: | PHP, Go"), rewritten cell by cell. The
 * row reads as its cells joined with " | ", so an edit that keeps that many
 * cells says which cell each part belongs to — adding a skill to a skills
 * table is exactly that. Refused when a cell holds more than one paragraph or
 * a line of its own, or has a tab inside it: then the parts no longer name
 * their cells.
 */
function planRowChange(members: Block[], prev: string, next: string): { write: () => void; readBack: string } | LineRefusal {
  if (members.some((b) => b.lines.length !== 1 || b.lines[0]!.includes(CELL_JOIN))) return 'resume.patch.line.rowAsLine';
  const cells = new Set(members.map((b) => b.table?.cell));
  if (cells.size !== members.length) return 'resume.patch.line.cellParagraphs';
  const before = prev.split(CELL_JOIN);
  const after = next.split(CELL_JOIN);
  if (before.length !== members.length || after.length !== members.length) return 'resume.patch.line.cellCount';
  const writes: Array<() => void> = [];
  const read: string[] = [];
  for (let i = 0; i < members.length; i++) {
    const was = before[i]!.trim();
    const now = after[i]!.trim();
    if (now.length === 0) return 'resume.patch.line.cellEmptied';
    read.push(readBack(members[i]!, was, now));
    if (was === now) continue;
    const write = planChange(members[i]!, 0, was, now);
    if (typeof write === 'string') return write;
    writes.push(write);
  }
  return { write: () => writes.forEach((w) => w()), readBack: read.join(CELL_JOIN) };
}

/* ---------- planning one change ---------- */

/**
 * Plan writing `next` where rendered line `line` of `block` was. Returns the
 * step to run, or the reason it cannot be done. The paragraph's runs are read
 * as tab groups; the new line is split the same way, so each side of a
 * `Company | Location` header lands in its own runs.
 */
function planChange(block: Block, line: number, prev: string, next: string): (() => void) | LineRefusal {
  if (boxed(block.node)) return 'resume.patch.line.textBox';
  const body = withoutMarker(block, line, prev, next);
  const segments = segmentsOf(block.node);
  const segment = segments[line];
  if (!segment) return 'resume.patch.line.misaligned';
  const parts = body.split(CELL_JOIN);
  if (parts.length !== segment.groups.length) return 'resume.patch.line.tabLayout';
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

function deleteReason(owner: LineOwner): LineRefusal | null {
  if (!owner) return 'resume.patch.line.noParagraph';
  if (owner.kind === 'row') return 'resume.patch.line.rowRemoved';
  if (owner.block.table) return 'resume.patch.line.cellRemoved';
  if (boxed(owner.block.node)) return 'resume.patch.line.textBox';
  if (owner.block.lines.length > 1) return 'resume.patch.line.sharedParagraph';
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
  setText(t, insertedBody(anchor, text));
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

