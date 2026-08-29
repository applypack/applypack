import { extname } from 'node:path';
import { docxToText, ResumeTextError } from './docx-text';
import { pdfToText } from './pdf-text';
import { ZipError } from './zip';

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt'] as const;
const MIN_TEXT_CHARS = 200;

/** Uploaded file → the plain text stored on Resume.text. Throws ResumeTextError with a user-facing message. */
export async function extractResumeText(filename: string, bytes: Buffer): Promise<string> {
  const ext = extname(filename).toLowerCase();
  let text: string;
  if (ext === '.pdf') {
    // pdfToText enforces its own minimum with a scanned-image hint.
    return pdfToText(bytes);
  } else if (ext === '.docx') {
    try {
      text = docxToText(bytes);
    } catch (err) {
      if (err instanceof ZipError) throw new ResumeTextError('The file is not a valid .docx (not a zip archive).');
      throw err;
    }
  } else if (ext === '.md' || ext === '.txt') {
    text = bytes.toString('utf8').replace(/\r\n/g, '\n').trim();
  } else {
    throw new ResumeTextError(
      `Unsupported file type "${ext || 'none'}". Upload ${ACCEPTED_EXTENSIONS.join(', ')}.`,
    );
  }
  if (text.length < MIN_TEXT_CHARS) {
    throw new ResumeTextError(
      `Only ${text.length} characters of text came out of the file — is it a real resume?`,
    );
  }
  return text;
}
