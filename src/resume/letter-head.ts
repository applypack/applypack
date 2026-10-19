import { structureFromText } from './structure-from-text';

/*
 * The top of a cover letter as a file (#581): who sends it and when, and the
 * paper it is set on. The letter itself names nobody's contacts (COVER_SYSTEM:
 * the sign-off is the name alone), so the file carries them, as a letter on
 * paper does. Pure — the writers (pdf-write.ts, docx-write.ts) draw it.
 */

export type Paper = 'a4' | 'letter';

/** Letter paper is what the US and Canada print on; everywhere else, and a posting that names no country, gets A4. */
const LETTER_COUNTRIES: ReadonlySet<string> = new Set(['US', 'CA']);

export function letterPaper(countries: readonly string[]): Paper {
  return countries.length > 0 && countries.every((c) => LETTER_COUNTRIES.has(c)) ? 'letter' : 'a4';
}

export interface LetterHead {
  /** The sender's name, set in bold; null when the resume's first line names nobody. */
  name: string | null;
  /** The city and the ways to reach the sender, in the resume's order: "Austin, TX · alex@example.com · (512) 555-0147". */
  contact: string | null;
  /** The day the file is made, the way the paper's country writes a date. */
  date: string;
}

const CONTACT_SEPARATOR = ' · ';

/**
 * The sender as their resume's header gives them (structure-from-text.ts),
 * and today's date. The letter is written in English whatever the interface
 * speaks, so the date is too: "October 19, 2026" on Letter, "19 October 2026"
 * on A4.
 */
export function letterHead(resumeText: string, paper: Paper, now: Date, timeZone: string): LetterHead {
  // A Markdown resume titles itself with its owner's name ("# Alex Rivera"), which the reader takes for a section.
  const { basics } = structureFromText(resumeText.replace(/^\s*# +/, ''));
  // Never the headline: a letter's head says who sends it and how to reach them (#624).
  const at = (part: string): number => {
    const i = resumeText.indexOf(part);
    return i < 0 ? resumeText.length : i;
  };
  const contact = [basics.location, basics.email, basics.phone, basics.url]
    .filter((part): part is string => Boolean(part?.trim()))
    .sort((a, b) => at(a) - at(b));
  return {
    name: basics.name?.trim() || null,
    contact: contact.length > 0 ? contact.join(CONTACT_SEPARATOR) : null,
    date: new Intl.DateTimeFormat(paper === 'letter' ? 'en-US' : 'en-GB', { dateStyle: 'long', timeZone }).format(now),
  };
}
