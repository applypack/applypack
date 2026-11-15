/*
 * The languages an interview may be held in (ADR 0065). Pure. Wider than the
 * interface's own languages on purpose: the page stays in the reader's
 * language, the questions and answers come in the one they will speak.
 * `name` is what the select shows, `english` what the prompt says.
 */

export const INTERVIEW_LANGUAGES = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'uk', name: 'Українська', english: 'Ukrainian' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'pl', name: 'Polski', english: 'Polish' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'nl', name: 'Nederlands', english: 'Dutch' },
  { code: 'cs', name: 'Čeština', english: 'Czech' },
] as const;

export type InterviewLanguage = (typeof INTERVIEW_LANGUAGES)[number];
export type InterviewLanguageCode = InterviewLanguage['code'];

export const DEFAULT_INTERVIEW_LANGUAGE: InterviewLanguageCode = 'en';

/** The language a form or a stored row names; null for anything else. */
export function interviewLanguage(code: unknown): InterviewLanguage | null {
  return INTERVIEW_LANGUAGES.find((l) => l.code === code) ?? null;
}
