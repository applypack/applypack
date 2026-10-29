import { extractText, getDocumentProxy } from 'unpdf';
import { ResumeTextError } from './docx-text';
import { joinWrapped } from './structure-from-text';

/*
 * PDF → plain text via unpdf (a self-contained serverless build of pdf.js —
 * pure JS, no workers, no canvas, CJS entry). Chosen over a hand-rolled
 * parser because real-world resume PDFs need font CMaps / ToUnicode tables
 * to decode text; see ADR 0011. Web-only like the rest of src/resume/.
 */

// Keep in sync with MIN_TEXT_CHARS in resume-text.ts — the PDF path throws
// its own message so a scanned image gets a useful hint, not a generic one.
const MIN_PDF_TEXT_CHARS = 200;

/**
 * A line this close to the longest on the page ran to the right margin: the
 * longest lines of a resume are the wrapped ones, and a proportional face
 * fits a few characters more or fewer on each (the clean PDF's wraps run
 * 103-111 characters). Under `MIN_PAGE_CHARS` the page has no width to read.
 */
const FULL_LINE_SHARE = 0.9;
const MIN_PAGE_CHARS = 60;

export async function pdfToText(bytes: Buffer): Promise<string> {
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    if ((err as { name?: string }).name === 'PasswordException') {
      throw new ResumeTextError('pdfPassword');
    }
    throw new ResumeTextError('pdfUnreadable');
  }
  let text: string;
  try {
    ({ text } = await extractText(doc, { mergePages: true }));
  } catch {
    throw new ResumeTextError('pdfNoExtract');
  } finally {
    // The serverless build's type defs omit destroy(); the runtime has it.
    await (doc as { destroy?: () => Promise<void> }).destroy?.()?.catch(() => undefined);
  }
  const normalized = normalizePdfText(text);
  if (normalized.length < MIN_PDF_TEXT_CHARS) {
    throw new ResumeTextError('pdfNoText', { n: normalized.length });
  }
  return normalized;
}

/**
 * Whitespace as a text layer leaves it, then the page-width wraps undone: a
 * PDF breaks a bullet or a "Technology Stack: a, b," line where the page
 * ends, and the same resume as .docx keeps them whole. Joined back the way
 * the structure floor joins them (`joinWrapped`), so a quote, a number in
 * a bullet or a stack line's label reads the same from either file — and,
 * the page's width being known here, a list cut inside a name ("…, Prompt" /
 * "Engineering, RAG") is joined too. Blank lines still separate paragraphs.
 */
export function normalizePdfText(text: string): string {
  const flat = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const longest = flat.split('\n').reduce((most, line) => Math.max(most, line.trim().length), 0);
  const fullWidth = longest >= MIN_PAGE_CHARS ? Math.ceil(longest * FULL_LINE_SHARE) : undefined;
  return flat
    .split(/\n\n+/)
    .map((paragraph) => joinWrapped(paragraph.split('\n'), { fullWidth }).join('\n'))
    .join('\n\n');
}
