import type { Document, Element } from '@xmldom/xmldom';
import { getDocumentProxy } from 'unpdf';
import { parseDocumentXml, W_NS } from './docx-text';
import { readZipEntry } from './zip';

/*
 * What typeface a resume is set in, read from the file itself (ADR 0039), so
 * the clean re-render arrives in the user's own typography instead of ours.
 *
 * The .docx half is pure. The PDF half is not — pdf.js is asynchronous — but
 * it takes bytes and returns a value, touches no database and fetches nothing.
 *
 * MEASURED, and this is the whole reason the code looks the way it does: on
 * the one real .docx in the corpus, styles.xml says Times New Roman 12 pt
 * with no accent, while the document's own runs say Arial with a blue
 * (0070C0) on 52 of them and a body size of 11 pt once each run is weighted
 * by the text it carries. Reading the style sheet would have dressed the
 * resume as a document it is not. So the runs decide, and styles.xml is only
 * the floor under a document that sets nothing itself.
 */

export interface InferredStyle {
  /** The family as the file names it — shown to the user, not necessarily bundled. */
  fontFamily: string | null;
  bodyPt: number | null;
  namePt: number | null;
  headingPt: number | null;
  /** Six hex digits, no hash. Only a .docx can say (see inferFromPdf). */
  accentHex: string | null;
  margins: Margins | null;
  page: PageSize | null;
  nameCentered: boolean | null;
  source: 'docx' | 'pdf' | 'none';
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type PageSize = 'A4' | 'LETTER';

export function blankStyle(): InferredStyle {
  return {
    fontFamily: null, bodyPt: null, namePt: null, headingPt: null,
    accentHex: null, margins: null, page: null, nameCentered: null, source: 'none',
  };
}

const DOCUMENT_PART = 'word/document.xml';
const STYLES_PART = 'word/styles.xml';
const TWIPS_PER_INCH = 1440;
/** A4 is 11 909 twips wide; Letter 12 240. Halfway between separates them. */
const A4_LETTER_SPLIT = 12_000;
/** Black, white, "auto" and any grey (equal channels) are text colour, not an accent. */
const NEUTRAL = /^(?:auto|window ?text|([0-9a-f]{2})\1\1)$/i;
/** Below this the "accent" is a stray highlight, not the document's colour. */
const MIN_ACCENT_RUNS = 3;
/** A name is the largest text on the page, but only if it is meaningfully larger. */
const NAME_OVER_BODY = 1.4;
/** A heading sits between the two. */
const HEADING_OVER_BODY = 1.05;

/* ---------- .docx ---------- */

export function inferFromDocx(bytes: Buffer): InferredStyle {
  let doc: Document;
  try {
    // readZipEntry throws on bytes that are not a zip at all, and
    // parseDocumentXml on XML the parser refuses: a file we cannot read has
    // no typography to report, which is exactly the blank style.
    const part = readZipEntry(bytes, DOCUMENT_PART);
    if (part === null) return blankStyle();
    doc = parseDocumentXml(part.toString('utf8'));
  } catch {
    return blankStyle();
  }
  const style = blankStyle();
  style.source = 'docx';

  // Weight every run by the characters it carries: a resume's font is the one
  // most of its words are set in, not the one that happens to occur most.
  const fonts = new Map<string, number>();
  const sizes = new Map<number, number>();
  const colours = new Map<string, number>();
  for (const run of elements(doc, 'r')) {
    const chars = textLength(run);
    if (chars === 0) continue;
    const props = child(run, 'rPr');
    const font = props ? child(props, 'rFonts')?.getAttribute('w:ascii') : null;
    if (font) fonts.set(font, (fonts.get(font) ?? 0) + chars);
    const half = Number(props ? child(props, 'sz')?.getAttribute('w:val') : NaN);
    if (Number.isFinite(half) && half > 0) sizes.set(half / 2, (sizes.get(half / 2) ?? 0) + chars);
    const colour = props ? child(props, 'color')?.getAttribute('w:val')?.toLowerCase() : null;
    if (colour && !NEUTRAL.test(colour)) colours.set(colour, (colours.get(colour) ?? 0) + 1);
  }

  style.fontFamily = heaviest(fonts) ?? styleSheetFont(bytes);
  style.bodyPt = round(heaviest(sizes) ?? styleSheetSize(bytes));
  const sorted = [...sizes.keys()].sort((a, b) => b - a);
  if (style.bodyPt !== null) {
    const name = sorted.find((pt) => pt >= style.bodyPt! * NAME_OVER_BODY) ?? null;
    style.namePt = round(name);
    style.headingPt = round(
      sorted.find((pt) => pt !== name && pt >= style.bodyPt! * HEADING_OVER_BODY) ?? null,
    );
  }
  // A colour on three runs is a scheme; on one it is somebody's typo.
  const accent = [...colours.entries()].filter(([, n]) => n >= MIN_ACCENT_RUNS).sort((a, b) => b[1] - a[1])[0];
  style.accentHex = accent ? accent[0] : null;

  const pgMar = elements(doc, 'pgMar')[0];
  if (pgMar) {
    const twips = (name: string) => Number(pgMar.getAttribute(`w:${name}`));
    const m = { top: twips('top'), right: twips('right'), bottom: twips('bottom'), left: twips('left') };
    if (Object.values(m).every((v) => Number.isFinite(v) && v >= 0)) {
      style.margins = {
        top: inches(m.top), right: inches(m.right), bottom: inches(m.bottom), left: inches(m.left),
      };
    }
  }
  const pgSz = elements(doc, 'pgSz')[0];
  const width = Number(pgSz?.getAttribute('w:w'));
  if (Number.isFinite(width) && width > 0) style.page = width >= A4_LETTER_SPLIT ? 'LETTER' : 'A4';

  const firstText = elements(doc, 'p').find((p) => textLength(p) > 0);
  if (firstText) {
    const jc = child(child(firstText, 'pPr') ?? firstText, 'jc')?.getAttribute('w:val');
    style.nameCentered = jc === 'center';
  }
  return style;
}

/** The style sheet's answer — used only where the document itself is silent. */
function styleSheet(bytes: Buffer): string | null {
  try {
    return readZipEntry(bytes, STYLES_PART)?.toString('utf8') ?? null;
  } catch {
    return null;
  }
}

function styleSheetFont(bytes: Buffer): string | null {
  const xml = styleSheet(bytes);
  return xml ? /w:ascii="([^"]+)"/.exec(xml)?.[1] ?? null : null;
}

function styleSheetSize(bytes: Buffer): number | null {
  const half = Number(styleSheet(bytes) ? /<w:sz w:val="(\d+)"/.exec(styleSheet(bytes) ?? '')?.[1] : NaN);
  return Number.isFinite(half) && half > 0 ? half / 2 : null;
}

function elements(root: Document | Element, name: string): Element[] {
  return [...(root.getElementsByTagNameNS(W_NS, name) as unknown as Iterable<Element>)];
}

function child(node: Element, name: string): Element | null {
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).namespaceURI === W_NS && (n as Element).localName === name) {
      return n as Element;
    }
  }
  return null;
}

function textLength(node: Element): number {
  return elements(node, 't').reduce((n, t) => n + (t.textContent ?? '').length, 0);
}

function inches(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * 100) / 100;
}

function round(pt: number | null): number | null {
  return pt === null ? null : Math.round(pt * 10) / 10;
}

function heaviest<T>(weights: Map<T, number>): T | null {
  let best: T | null = null;
  let bestWeight = 0;
  for (const [key, weight] of weights) if (weight > bestWeight) { best = key; bestWeight = weight; }
  return best;
}

/* ---------- PDF ---------- */

interface TextItem {
  str: string;
  fontName: string;
  transform: number[];
  width: number;
  height: number;
}

/**
 * The same reading from a PDF. Two things the guide's recipe got wrong, both
 * measured on the corpus:
 *
 * - `getTextContent().styles[fontName].fontFamily` returns the CSS generic
 *   ("sans-serif") and never the family. The real name lives in
 *   `page.commonObjs` — `AAAAAU+ArialMT` — but only after `getOperatorList()`
 *   has populated it, so that call is not optional.
 * - There is no accent. pdf.js does not expose fill colours in a shape worth
 *   guessing at, so `accentHex` stays null and the render page's knob decides.
 */
export async function inferFromPdf(bytes: Buffer): Promise<InferredStyle> {
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    return blankStyle();
  }
  const style = blankStyle();
  style.source = 'pdf';
  try {
    const fonts = new Map<string, number>();
    const sizes = new Map<number, number>();
    let namePt = 0;
    let nameLeft = Infinity;
    let nameRight = -Infinity;
    let pageWidth = 0;
    let pageHeight = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 }) as { width: number; height: number };
      if (n === 1) { pageWidth = viewport.width; pageHeight = viewport.height; }
      // Populates commonObjs, which is where the real font names are.
      await page.getOperatorList();
      const objects = page.commonObjs as unknown as { has(k: string): boolean; get(k: string): { name?: string } };
      const content = await page.getTextContent();
      for (const item of content.items as TextItem[]) {
        const chars = item.str?.trim().length ?? 0;
        if (chars === 0) continue;
        const family = fontFamily(objects, item.fontName);
        if (family) fonts.set(family, (fonts.get(family) ?? 0) + chars);
        const pt = Math.round(Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0) * 10) / 10;
        if (pt > 0) sizes.set(pt, (sizes.get(pt) ?? 0) + chars);
        const x = item.transform[4] ?? 0;
        const y = item.transform[5] ?? 0;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x + item.width);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y + item.height);
        // The name is usually several items ("Nazar", "Boyko"), so its centre
        // is the extent of everything set at the biggest size, not the first
        // piece of it — measured: the first piece alone reads as left-aligned.
        if (n === 1 && pt >= namePt) {
          if (pt > namePt) { namePt = pt; nameLeft = x; nameRight = x + item.width; }
          else { nameLeft = Math.min(nameLeft, x); nameRight = Math.max(nameRight, x + item.width); }
        }
      }
    }

    style.fontFamily = heaviest(fonts);
    style.bodyPt = round(heaviest(sizes));
    style.namePt = namePt > 0 ? round(namePt) : null;
    if (style.bodyPt !== null) {
      const sorted = [...sizes.keys()].sort((a, b) => b - a);
      style.headingPt = round(
        sorted.find((pt) => pt !== namePt && pt >= style.bodyPt! * HEADING_OVER_BODY) ?? null,
      );
    }
    if (pageWidth > 0) {
      style.page = pageWidth > 600 ? 'LETTER' : 'A4';
      if (Number.isFinite(minX) && Number.isFinite(maxY)) {
        style.margins = {
          left: pt(minX), right: pt(pageWidth - maxX), top: pt(pageHeight - maxY), bottom: pt(minY),
        };
      }
      // Centred within a twentieth of the page — a title block, not a margin note.
      if (Number.isFinite(nameLeft) && Number.isFinite(nameRight)) {
        style.nameCentered = Math.abs((nameLeft + nameRight) / 2 - pageWidth / 2) < pageWidth / 20;
      }
    }
  } catch {
    return { ...blankStyle(), source: 'pdf' };
  } finally {
    await (doc as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
  }
  return style;
}

/** `AAAAAU+ArialMT` → `Arial`: the subset prefix and the PostScript suffixes off. */
export function fontFamily(
  objects: { has(k: string): boolean; get(k: string): { name?: string } },
  fontName: string,
): string | null {
  let raw: string | undefined;
  try {
    raw = objects.has(fontName) ? objects.get(fontName)?.name : undefined;
  } catch {
    return null;
  }
  return raw ? cleanFontName(raw) : null;
}

export function cleanFontName(raw: string): string | null {
  // The suffixes nest — "TimesNewRomanPS-BoldMT" carries three — so peel until
  // nothing more comes off rather than trusting one pass in one order.
  let name = raw.replace(/^[A-Z]{6}\+/, '').trim();
  for (let before = ''; before !== name; ) {
    before = name;
    name = name
      .replace(/(?:PSMT|PS|MT)$/, '')
      .replace(/[-,](?:Regular|Bold|Italic|BoldItalic|Light|Medium|Roman|Oblique|BoldOblique)$/i, '')
      .replace(/[-,]$/, '')
      .trim();
  }
  // PostScript names run the words together; a person reading "Times New
  // Roman" on the page should not be shown "TimesNewRoman".
  name = name.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2');
  return name.length > 0 ? name : null;
}


function pt(value: number): number {
  return Math.round((value / 72) * 100) / 100;
}
