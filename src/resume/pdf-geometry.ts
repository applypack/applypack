import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';

/*
 * What a PDF resume looks like on its page, read off pdf.js: every text item
 * with its place, size, weight and — character by character — its colour,
 * and the horizontal rules the page draws. No text is extracted here that
 * pdf-text.ts does not already read; this is the geometry beside it, for the
 * clean version to be set the way the original was (pdf-layout.ts).
 *
 * Two things pdf.js does not hand over directly, and how they are got:
 *
 * - Colour. getTextContent() carries no colour at all. The operator list
 *   does: each showText runs under the last fill colour set. The glyphs of
 *   the showText calls, in order, are the same characters as the text items
 *   in order — both are built from one content stream — so the colours are
 *   laid onto the items by walking the two in step, spaces aside.
 * - Weight. The font's real name ("AAAAAK+Arial-BoldMT") is in commonObjs,
 *   and only after getOperatorList() has run (style-infer.ts, measured).
 *   Since pdf.js 6.4 (unpdf 1.9) the worker sends it only when the document
 *   is opened with `fontExtraProperties` — `FONT_NAMES` below.
 */

/** Opens a document so that commonObjs carries each font's real `name`. */
export const FONT_NAMES = { fontExtraProperties: true } as const;

export interface PdfItem {
  str: string;
  /** Baseline start, in points from the page's bottom-left corner. */
  x: number;
  y: number;
  width: number;
  /** Font size in points. */
  size: number;
  bold: boolean;
  /** One fill colour per character of `str` ("#0070c0"), null where the walk lost its place. */
  colors: Array<string | null>;
}

/** A thin horizontal band the page draws — a rule under a heading, or under the header. */
export interface PdfRule {
  x0: number;
  x1: number;
  y: number;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfItem[];
  rules: PdfRule[];
}

/** A band this thin, and this wide, is a rule rather than a box or a bullet. */
const RULE_MAX_HEIGHT_PT = 2.5;
const RULE_MIN_WIDTH_SHARE = 0.4;
/** How far ahead the colour walk looks for a character it lost, before it gives the item up. */
const RESYNC_WINDOW = 48;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** A character as compared across the two walks: compatibility forms folded, so a formula's 𝑂 is an O on both sides. */
const fold = (ch: string) => ch.normalize('NFKC');

interface Glyph {
  ch: string;
  color: string | null;
}

/**
 * The page's geometry, or null when the file is not a PDF pdf.js can open.
 * Never throws for a malformed page: what could not be read is left out.
 */
export async function readPdfGeometry(bytes: Buffer): Promise<PdfPage[] | null> {
  let doc;
  let ops: OpCodes;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes), FONT_NAMES);
    // The operator table sits in pdf.js itself; its ESM-only entry is out of a CommonJS build's reach.
    ops = (await getResolvedPDFJS()).OPS as unknown as OpCodes;
  } catch {
    return null;
  }
  const pages: PdfPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 }) as { width: number; height: number };
      const list = await page.getOperatorList();
      const { glyphs, rules } = walkOperators(list.fnArray, list.argsArray, viewport.width, ops);
      const objects = page.commonObjs as unknown as { has(k: string): boolean; get(k: string): { name?: string } };
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      let at = 0;
      for (const raw of content.items as Array<{ str?: string; transform?: number[]; width?: number; fontName?: string }>) {
        const str = raw.str ?? '';
        if (str.length === 0 || !raw.transform) continue;
        const colors: Array<string | null> = [];
        for (const ch of str) {
          if (/\s/.test(ch)) { colors.push(null); continue; }
          const want = fold(ch);
          let hit = -1;
          for (let k = at; k < Math.min(glyphs.length, at + RESYNC_WINDOW); k++) {
            if (glyphs[k]!.ch === want) { hit = k; break; }
          }
          if (hit === -1) { colors.push(null); continue; }
          colors.push(glyphs[hit]!.color);
          at = hit + 1;
        }
        items.push({
          str,
          x: raw.transform[4] ?? 0,
          y: raw.transform[5] ?? 0,
          width: raw.width ?? 0,
          size: Math.round(Math.hypot(raw.transform[0] ?? 0, raw.transform[1] ?? 0) * 10) / 10,
          bold: isBold(objects, raw.fontName ?? ''),
          colors,
        });
      }
      pages.push({ width: viewport.width, height: viewport.height, items, rules });
    }
  } catch {
    return pages.length > 0 ? pages : null;
  } finally {
    await (doc as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
  }
  return pages;
}

function isBold(objects: { has(k: string): boolean; get(k: string): { name?: string } }, fontName: string): boolean {
  try {
    const name = objects.has(fontName) ? (objects.get(fontName)?.name ?? '') : '';
    return /bold|black|heavy|semibold|demi/i.test(name);
  } catch {
    return false;
  }
}

/**
 * The glyphs in drawing order with the fill colour each was drawn in, and the
 * thin horizontal bands among the paths. The graphics state is tracked only as
 * far as these two need: the fill colour and the transform, through save and
 * restore.
 */
type OpCodes = Record<'save' | 'restore' | 'transform' | 'setFillRGBColor' | 'showText' | 'showSpacedText' | 'constructPath', number>;

function walkOperators(fns: number[], args: unknown[][], pageWidth: number, OPS: OpCodes): { glyphs: Glyph[]; rules: PdfRule[] } {
  const glyphs: Glyph[] = [];
  const rules: PdfRule[] = [];
  let fill: string | null = '#000000';
  let ctm: Matrix = IDENTITY;
  const stack: Array<{ fill: string | null; ctm: Matrix }> = [];
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i];
    const a = args[i] ?? [];
    if (fn === OPS.save) stack.push({ fill, ctm });
    else if (fn === OPS.restore) ({ fill, ctm } = stack.pop() ?? { fill, ctm });
    else if (fn === OPS.transform) ctm = multiply(ctm, a as Matrix);
    else if (fn === OPS.setFillRGBColor) fill = typeof a[0] === 'string' ? a[0].toLowerCase() : fill;
    else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      for (const g of (a[0] as unknown[]) ?? []) {
        const unicode = (g as { unicode?: unknown } | null)?.unicode;
        if (typeof unicode !== 'string') continue;
        for (const ch of fold(unicode)) if (!/\s/.test(ch)) glyphs.push({ ch, color: fill });
      }
    } else if (fn === OPS.constructPath) {
      const rule = ruleOf(a[2], ctm, pageWidth);
      if (rule) rules.push(rule);
    }
  }
  return { glyphs, rules };
}

/** The path's bounding box (pdf.js hands it over as the op's third argument), when it is a rule. */
function ruleOf(box: unknown, ctm: Matrix, pageWidth: number): PdfRule | null {
  if (!box || typeof box !== 'object') return null;
  const b = box as Record<string, number>;
  const [x0, y0, x1, y1] = [b[0], b[1], b[2], b[3]];
  if (![x0, y0, x1, y1].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const corners = [apply(ctm, x0!, y0!), apply(ctm, x1!, y1!)];
  const left = Math.min(corners[0]![0], corners[1]![0]);
  const right = Math.max(corners[0]![0], corners[1]![0]);
  const bottom = Math.min(corners[0]![1], corners[1]![1]);
  const top = Math.max(corners[0]![1], corners[1]![1]);
  if (top - bottom > RULE_MAX_HEIGHT_PT || right - left < pageWidth * RULE_MIN_WIDTH_SHARE) return null;
  return { x0: left, x1: right, y: (top + bottom) / 2 };
}
