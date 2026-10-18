import { docxStructure } from './docx-structure';
import { docxToText } from './docx-text';
import { patchDocx } from './docx-patch';
import { structureFromText, type TextLayout } from './structure-from-text';
import { drawDocx } from './render/clean-docx';
import { drawPdf } from './render/clean-pdf';
import type { RenderKnobs } from './render/knobs';
import { planLines, planRender, planToText, type PlanOptions, type RenderPlan } from './render/sections';
import { t } from '../i18n/t';

/*
 * The resume on the Tailor page as a document rather than a text: the draft
 * in the editor, drawn as the file it would be if it were saved now. Pure —
 * bytes and texts in, bytes out; the route loads the resume and its
 * typography, this decides what the document is.
 *
 * Two kinds, and nothing in between. The user's own .docx with the edits
 * written into it by the patcher (ADR 0038), whenever the patcher takes them:
 * that is their file, their design, byte for byte outside the edited runs.
 * Otherwise the clean version (ADR 0039) — the same text re-set in their
 * typeface — and a sentence saying why, because a page that swapped the
 * user's design for ours without a word would be the "saved in another style"
 * surprise this whole feature exists to avoid. No AI is involved in either.
 */

export type DocumentKind = 'own' | 'clean';

/** Why the document is what it is — the page words its note from this. */
export type DocumentBasis = 'own' | 'pdf' | 'text' | 'unsupported' | 'stale' | 'refused';

export interface DraftInput {
  sourceFilename: string;
  /** The stored file; null when there is none to read. */
  original: Buffer | null;
  /** The text the edits started from — the comparison's analysed text. */
  baseText: string;
  /** The draft in the editor. */
  text: string;
  /** The clean version's typography, read from the user's own file. */
  knobs: RenderKnobs;
  /** What a PDF's page says about its lines — its columns and its skills table (pdf-layout.ts). */
  layout?: TextLayout | null;
}

export interface DraftDocument {
  kind: DocumentKind;
  basis: DocumentBasis;
  docx: Buffer;
  /** One sentence for the page when the document is not the user's own file; null when it is. */
  notice: string | null;
}

const isDocx = (name: string) => /\.docx$/i.test(name);
const isPdf = (name: string) => /\.pdf$/i.test(name);
/** The patcher's own sentence when the comparison read another version of the file. */
const STALE_REASON = /analysed text does not match/;

export async function draftDocx(input: DraftInput): Promise<DraftDocument> {
  const { original, sourceFilename } = input;
  if (original && isDocx(sourceFilename)) {
    if (docxStructure(original).kind === 'unsupported') return clean(input, 'unsupported');
    const patched = await patchDocx(original, input.baseText, input.text);
    if (patched.ok) return { kind: 'own', basis: 'own', docx: patched.docx, notice: null };
    // `reason` is the patcher's English, which STALE_REASON reads; `shown` is the same sentence in the page's language.
    return clean(input, STALE_REASON.test(patched.reason) ? 'stale' : 'refused', patched.shown);
  }
  return clean(input, isPdf(sourceFilename) ? 'pdf' : 'text');
}

/** The clean .pdf of the draft; the user's own .docx has no PDF of ours (the route prints or converts it). */
export async function draftPdf(input: DraftInput): Promise<Buffer> {
  return drawPdf(cleanPlan(input.text, input.knobs, input.layout ?? null, { fold: true }), input.knobs);
}

async function clean(input: DraftInput, basis: Exclude<DocumentBasis, 'own'>, reason?: string): Promise<DraftDocument> {
  const docx = await drawDocx(cleanPlan(input.text, input.knobs, input.layout ?? null, { fold: false }), input.knobs);
  return { kind: 'clean', basis, docx, notice: noticeFor(basis, reason) };
}

/**
 * The plan the clean version is drawn from: the resume read into sections and
 * roles, unless that reading would drop a line — then every line as it
 * stands. Measured on the table fixture: the structured reading kept one
 * line of eleven, because the whole table arrives as one run-on "heading".
 */
function cleanPlan(text: string, knobs: RenderKnobs, layout: TextLayout | null, opts: PlanOptions): RenderPlan {
  const structure = structureFromText(text, layout);
  // Decided on the unfolded reading, so a ₴ the PDF face cannot draw does not
  // turn the whole file into the plainer line-by-line version.
  const keeps = missingLines(text, planToText(planRender(structure, knobs, { fold: false }))).length === 0;
  return keeps ? planRender(structure, knobs, opts) : planLines(text, opts);
}

/** What stands between items and is not content: a render may write one for another. */
const SEPARATORS = /[∙·•‣▪◦|]/gu;

/**
 * A line's content, as a render must keep it: letters, digits and symbols
 * (₴, ✓, ★, +, $) — case, spacing, punctuation and separators aside. Letters
 * alone let a save that dropped "₴" and "✓" pass as whole — found in review, 2026-09-30.
 */
export function contentKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(SEPARATORS, '').replace(/[^\p{L}\p{N}\p{S}]+/gu, '');
}

/**
 * Every line of `text` whose words a rendered text does not carry, in order.
 * Order-free on purpose: a render may move a line (a role's stack line after
 * its bullets) or split one (a company from its place), and neither loses it.
 */
function missingLines(text: string, rendered: string): string[] {
  const haystack = contentKey(rendered);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      const words = contentKey(line);
      return words.length > 0 && !haystack.includes(words);
    });
}

/**
 * The clean .docx of a text as Save stores it: the file, what it reads back as
 * (the version's text), and any line it would lose — Save keeps a text
 * version rather than a file that dropped a word of the resume.
 */
export async function cleanDocx(
  text: string,
  knobs: RenderKnobs,
  layout: TextLayout | null = null,
): Promise<{ docx: Buffer; text: string; missing: string[] }> {
  const docx = await drawDocx(cleanPlan(text, knobs, layout, { fold: false }), knobs);
  const read = docxToText(docx);
  return { docx, text: read, missing: missingLines(text, read) };
}

/** Why the page shows the clean version — what happened, what is safe, the way back. */
export function noticeFor(basis: Exclude<DocumentBasis, 'own'>, reason?: string): string {
  switch (basis) {
    case 'pdf':
      return t('document.notice.pdf');
    case 'text':
      return t('document.notice.text');
    case 'unsupported':
      return t('document.notice.unsupported');
    case 'stale':
      return t('document.notice.stale');
    case 'refused':
      // The reason is the patcher's own sentence (docx-patch.ts), already in the page's language.
      return t('document.notice.refused', { reason: reason ?? t('document.notice.someLine') });
  }
}

/** A file name a recruiter's inbox shows as written: the resume's own name, nothing a file system refuses. */
export function documentFileName(name: string, ext: 'docx' | 'pdf'): string {
  const clean = name
    .replace(/\.(docx|pdf|md|txt)$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Cut by code point: half an emoji's surrogate pair made encodeURIComponent
  // throw in contentDisposition, and the download answered 500.
  const base = Array.from(clean).slice(0, MAX_FILE_NAME_CHARS).join('').trim();
  return `${base || 'Resume'}.${ext}`;
}

const MAX_FILE_NAME_CHARS = 80;

/**
 * `attachment` with the name in both forms: an ASCII fallback, and the UTF-8
 * one (RFC 6266 / 5987) a Cyrillic name needs — a header value is bytes, and
 * Node refuses to send one it cannot encode.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').trim() || 'resume';
  // encodeURIComponent leaves ' ( ) * alone, and RFC 5987 allows none of them in the value.
  const utf8 = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
