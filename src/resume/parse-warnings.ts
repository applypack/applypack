/*
 * Deterministic ATS-parseability checks over the extracted resume text —
 * the cheap version of a parser-robustness analyzer (no second parser, no
 * AI). Shown on the resume page next to "what the ATS sees". Pure.
 */

export interface ParseWarning {
  code: string;
  message: string;
}

const MIN_TEXT_CHARS = 300;
/** ~3500 chars ≈ one US letter page of resume text. */
const CHARS_PER_PAGE = 3_500;
const MAX_PAGES = 2;
/** Average word length above this means extraction probably lost spaces. */
const GLUED_AVG_WORD_LEN = 11;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RUN_RE = /\+?\d[\d\s().\/-]{6,}\d/g;
/** A phone needs ≥9 digits in one run — "2022-2026" date ranges have 8. */
const PHONE_MIN_DIGITS = 9;
// C0 controls except \t \n \r — leftovers from broken PDF extraction.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function parseWarnings(text: string): ParseWarning[] {
  const warnings: ParseWarning[] = [];
  const len = text.length;

  if (len < MIN_TEXT_CHARS) {
    warnings.push({
      code: 'too_short',
      message: `Only ${len} characters extracted — likely a scanned or image-based file; most ATS parsers will see almost nothing.`,
    });
    return warnings; // Everything below would just be noise on top of this.
  }

  const replacementChars = (text.match(/�/g) ?? []).length;
  if (replacementChars > 0) {
    warnings.push({
      code: 'unreadable_chars',
      message: `${replacementChars} unreadable character${replacementChars === 1 ? '' : 's'} (�) — the file's fonts don't map to text; an ATS sees the same garbage.`,
    });
  }

  const controlChars = (text.match(CONTROL_RE) ?? []).length;
  if (controlChars > 0) {
    warnings.push({
      code: 'control_chars',
      message: `${controlChars} control character${controlChars === 1 ? '' : 's'} in the text — unusual encoding; some parsers truncate at these.`,
    });
  }

  if (!EMAIL_RE.test(text)) {
    warnings.push({
      code: 'no_email',
      message: 'No email address in the extracted text — if it lives in a header, image or text box, ATS contact mapping misses it.',
    });
  }

  const hasPhone = (text.match(PHONE_RUN_RE) ?? []).some(
    (run) => (run.match(/\d/g) ?? []).length >= PHONE_MIN_DIGITS,
  );
  if (!hasPhone) {
    warnings.push({
      code: 'no_phone',
      message: 'No phone number in the extracted text — same header/graphic risk as the email.',
    });
  }

  const words = text.split(/\s+/).filter(Boolean);
  const avgWordLen = words.length > 0 ? len / words.length : 0;
  if (avgWordLen > GLUED_AVG_WORD_LEN) {
    warnings.push({
      code: 'glued_words',
      message: 'Unusually long "words" — extraction may have lost spaces (ligatures or column layout); check the text below reads normally.',
    });
  }

  const pages = Math.ceil(len / CHARS_PER_PAGE);
  if (pages > MAX_PAGES) {
    warnings.push({
      code: 'too_long',
      message: `≈${pages} pages of text — over the ${MAX_PAGES}-page US norm; recruiters skim, parsers rank early content higher.`,
    });
  }

  return warnings;
}
