/*
 * Deterministic ATS-parseability checks over the extracted resume text —
 * the cheap version of a parser-robustness analyzer (no second parser, no
 * AI). Shown on the resume page next to "what the ATS sees". Pure.
 */

import { SOURCE_LOCALE, withLocale } from '../i18n/locale';
import type { MessageParams } from '../i18n/message';
import { t } from '../i18n/t';

type WarningCode = 'too_short' | 'unreadable_chars' | 'control_chars' | 'no_email' | 'no_phone' | 'glued_words' | 'too_long';

export interface ParseWarning {
  code: WarningCode;
  /** The sentence in English, whatever language the page is in: the review prompt quotes it (review.ts). */
  message: string;
  /** The same sentence in the reader's language, and the code as a page's badge words it. */
  shown: string;
  label: string;
}

/** A warning's sentence is `parsed.warning.<code>` and its badge `parsed.warningLabel.<code>`. */
function warning(code: WarningCode, params: MessageParams = {}): ParseWarning {
  return {
    code,
    message: withLocale(SOURCE_LOCALE, () => t(`parsed.warning.${code}`, params)),
    shown: t(`parsed.warning.${code}`, params),
    label: t(`parsed.warningLabel.${code}`),
  };
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

function hasPhone(text: string): boolean {
  return (text.match(PHONE_RUN_RE) ?? []).some((run) => (run.match(/\d/g) ?? []).length >= PHONE_MIN_DIGITS);
}

/**
 * Whether a span carries an email address or a phone number — the two things
 * gotcha 11 keeps losing to a removal quote. Exported so the removal gate
 * (replacement-gate.ts) protects the contact line with the same test the
 * warnings and the browser's `removeSpan` use.
 */
export function hasContactDetail(text: string): boolean {
  return EMAIL_RE.test(text) || hasPhone(text);
}

export function parseWarnings(text: string): ParseWarning[] {
  const warnings: ParseWarning[] = [];
  const len = text.length;

  if (len < MIN_TEXT_CHARS) {
    warnings.push(warning('too_short', { n: len }));
    return warnings; // Everything below would just be noise on top of this.
  }

  const replacementChars = (text.match(/�/g) ?? []).length;
  if (replacementChars > 0) {
    warnings.push(warning('unreadable_chars', { n: replacementChars }));
  }

  const controlChars = (text.match(CONTROL_RE) ?? []).length;
  if (controlChars > 0) {
    warnings.push(warning('control_chars', { n: controlChars }));
  }

  if (!EMAIL_RE.test(text)) {
    warnings.push(warning('no_email'));
  }

  if (!hasPhone(text)) {
    warnings.push(warning('no_phone'));
  }

  const words = text.split(/\s+/).filter(Boolean);
  const avgWordLen = words.length > 0 ? len / words.length : 0;
  if (avgWordLen > GLUED_AVG_WORD_LEN) {
    warnings.push(warning('glued_words'));
  }

  const pages = Math.ceil(len / CHARS_PER_PAGE);
  if (pages > MAX_PAGES) {
    warnings.push(warning('too_long', { pages, max: MAX_PAGES }));
  }

  return warnings;
}
