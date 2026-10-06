import { structureFromText } from '../resume/structure-from-text';
import { t } from '../i18n/t';

/*
 * "What a parser reads" on /resumes/:id (TASKS R12): the name, the contacts,
 * the sections and the roles with their dates, as a plain reader pulls them
 * out of the extracted text — no model. What is missing here is what a
 * recruiter's ATS is likely to miss too. Pure: structure-from-text.ts reads.
 */

/** Which contact a row is, whatever language its label is written in. */
export type ContactKind = 'email' | 'phone' | 'link' | 'location';

export interface ParsedView {
  name: string | null;
  headline: string | null;
  contacts: { kind: ContactKind; label: string; value: string | null }[];
  /** The sections found, in reading order of the kinds the reader knows. */
  sections: string[];
  /** How many of them, the last ones, are headings in the file's own words: the page shows those as written. */
  ownHeadings: number;
  roles: { title: string; company: string | null; dates: string | null; bullets: number }[];
  education: { title: string; dates: string | null }[];
}

const dates = (start: string | null, end: string | null): string | null =>
  start || end ? `${start ?? '?'} – ${end ?? '?'}` : null;

/** The separators a reader leaves at the edge of a flattened table row: "Acme |" is Acme. */
const EDGE_SEPARATORS = /^[\s|·•,]+|[\s|·•,]+$/g;
const tidy = (s: string | null): string | null => s?.replace(EDGE_SEPARATORS, '') || null;

export function parsedView(text: string): ParsedView {
  const r = structureFromText(text);
  const sections = [
    r.basics.summary ? t('parsed.section.summary') : null,
    r.skills.length > 0 ? t('parsed.section.skills', { n: r.skills.length }) : null,
    r.work.length > 0 ? t('parsed.section.experience', { n: r.work.length }) : null,
    r.education.length > 0 ? t('parsed.section.education') : null,
    r.languages.length > 0 ? t('parsed.section.languages') : null,
    r.certificates.length > 0 ? t('parsed.section.certificates') : null,
    r.projects.length > 0 ? t('parsed.section.projects') : null,
    ...r.extras.map((e) => e.heading),
  ].filter((s): s is string => s !== null);
  return {
    name: r.basics.name,
    headline: r.basics.label,
    contacts: [
      { kind: 'email', label: t('parsed.contact.email'), value: r.basics.email },
      { kind: 'phone', label: t('parsed.contact.phone'), value: r.basics.phone },
      { kind: 'link', label: t('parsed.contact.link'), value: r.basics.url ?? r.basics.profiles[0] ?? null },
      { kind: 'location', label: t('parsed.contact.location'), value: r.basics.location },
    ],
    sections,
    ownHeadings: r.extras.length,
    roles: r.work.map((w) => ({
      title: tidy(w.position ?? w.name) ?? t('parsed.roleNoTitle'),
      company: w.position ? tidy(w.name) : null,
      dates: dates(w.startDate, w.endDate),
      bullets: w.highlights.length,
    })),
    education: r.education.map((e) => ({
      title: tidy([e.studyType, e.area, e.institution].filter(Boolean).join(', ')) ?? t('parsed.educationNoName'),
      dates: dates(e.startDate, e.endDate),
    })),
  };
}
