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

export async function pdfToText(bytes: Buffer): Promise<string> {
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    if ((err as { name?: string }).name === 'PasswordException') {
      throw new ResumeTextError('The PDF is password-protected — remove the password and upload again.');
    }
    throw new ResumeTextError('The file is not a readable PDF.');
  }
  let text: string;
  try {
    ({ text } = await extractText(doc, { mergePages: true }));
  } catch {
    throw new ResumeTextError('Could not extract text from the PDF — is it corrupted?');
  } finally {
    // The serverless build's type defs omit destroy(); the runtime has it.
    await (doc as { destroy?: () => Promise<void> }).destroy?.()?.catch(() => undefined);
  }
  const normalized = normalizePdfText(text);
  if (normalized.length < MIN_PDF_TEXT_CHARS) {
    throw new ResumeTextError(
      `Only ${normalized.length} characters of text came out of the PDF — a scanned image or an ` +
        'outlined-text export has no text layer. Export a text-based PDF or upload the .docx.',
    );
  }
  return normalized;
}

/**
 * Whitespace as a text layer leaves it, then the page-width wraps undone: a
 * PDF breaks a bullet or a "Technology Stack: a, b," line where the page
 * ends, and the same resume as .docx keeps them whole. Joined back the way
 * the structure floor joins them (`joinWrapped`), so a quote, a number in
 * a bullet or a stack line's label reads the same from either file.
 * Blank lines still separate paragraphs.
 */
export function normalizePdfText(text: string): string {
  const flat = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return flat
    .split(/\n\n+/)
    .map((paragraph) => joinWrapped(paragraph.split('\n')).join('\n'))
    .join('\n\n');
}
