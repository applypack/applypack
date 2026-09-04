/*
 * The document properties of a .docx (docProps/core.xml and app.xml): who a
 * file says wrote it, and the one edit this product makes to them (ADR 0038).
 * Pure — bytes in, bytes out. `withProps` touches core.xml and nothing else,
 * and the test holds every `word/*` part byte-identical afterwards.
 *
 * The properties matter because a resume built from a downloaded template
 * carries the template author's name and a stranger's application as its
 * creator — resume 1 did — and a human opening File → Properties sees it.
 * No ATS rejects on it (tailoring-loop-plan.md §4), so this is offered on
 * click with the current values printed, never done silently.
 */

import JSZip from 'jszip';
import { readZipEntry } from './zip';

const CORE_PART = 'docProps/core.xml';
const APP_PART = 'docProps/app.xml';

export interface DocxProps {
  title: string | null;
  creator: string | null;
  lastModifiedBy: string | null;
  /** ISO timestamp from dcterms:modified, as written. */
  modified: string | null;
  /** The producing application, from app.xml ("Microsoft Office Word"). */
  application: string | null;
}

export interface PropsPatch {
  title?: string;
  creator?: string;
  lastModifiedBy?: string;
}

const element = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xml);
  return m ? decode(m[1] ?? '') : null;
};

export function readProps(bytes: Buffer): DocxProps {
  const core = readZipEntry(bytes, CORE_PART)?.toString('utf8') ?? '';
  const app = readZipEntry(bytes, APP_PART)?.toString('utf8') ?? '';
  return {
    title: element(core, 'dc:title'),
    creator: element(core, 'dc:creator'),
    lastModifiedBy: element(core, 'cp:lastModifiedBy'),
    modified: element(core, 'dcterms:modified'),
    application: element(app, 'Application'),
  };
}

/**
 * Rewrite the named properties and stamp dcterms:modified with `now`; every
 * other part is carried over untouched. A property the file never had is
 * added before `</cp:coreProperties>`.
 */
export async function withProps(bytes: Buffer, patch: PropsPatch, now: Date = new Date()): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes, { createFolders: false });
  const file = zip.file(CORE_PART);
  // A package without core.xml has nothing to fix; adding an orphan part would
  // need a content-type override and a relationship, so it is left alone.
  if (!file) return bytes;
  zip.file(CORE_PART, setCoreProps(await file.async('string'), patch, now), { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * core.xml with the named properties rewritten and dcterms:modified stamped
 * with `now`. Pure on the string, so the patcher can apply it inside its own
 * archive rewrite. A property the part never had is added before the close.
 */
export function setCoreProps(core: string, patch: PropsPatch, now: Date): string {
  let xml = core;
  const set = (name: string, value: string, attrs = '') => {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>[^<]*</${name}>`);
    const tag = `<${name}${attrs}>${encode(value)}</${name}>`;
    xml = re.test(xml) ? xml.replace(re, tag) : xml.replace('</cp:coreProperties>', `${tag}</cp:coreProperties>`);
  };
  if (patch.title !== undefined) set('dc:title', patch.title);
  if (patch.creator !== undefined) set('dc:creator', patch.creator);
  if (patch.lastModifiedBy !== undefined) set('cp:lastModifiedBy', patch.lastModifiedBy);
  set('dcterms:modified', now.toISOString().replace(/\.\d{3}Z$/, 'Z'), ' xsi:type="dcterms:W3CDTF"');
  return xml;
}

function encode(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
