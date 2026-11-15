/*
 * The resume as tailored for one posting (ADR 0066): its name, its file's
 * name, and how its file was made. Pure — `store.ts` keeps the row, the
 * Tailor page's Save writes it. Tested in tailored.test.ts.
 *
 * Save on the Tailor page used to write the next version of the resume
 * itself, so after five applications the "resume" was the fifth posting's
 * wording and every later comparison, letter and pack started from it (#641).
 * A copy belongs to its posting; the resume changes from its own page, or by
 * one explicit press on a copy.
 */

/** How a copy's file was made: the person's own .docx written into, the clean version, or the text alone. */
export type CopyDocument = 'own' | 'clean' | 'text';

/** "Dana Ruiz — Fernway": the resume it came from and who it is for; the resume's name alone when nobody is named. */
export function copyName(resumeName: string, company: string | null): string {
  const who = company?.trim();
  return who ? `${resumeName.trim()} — ${who}` : resumeName.trim();
}

const slug = (words: string): string => words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** "dana-ruiz-fernway.docx": a name a person finds in Downloads a month later. No version — the copy has none. */
export function copyFileName(resumeName: string, company: string | null, ext: string): string {
  const base = [slug(resumeName), slug(company ?? '')].filter((part) => part.length > 0).join('-') || 'resume';
  return `${base}.${ext}`;
}
