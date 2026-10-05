/*
 * The Overview's "next three things" (TASKS N11): the wizard ends with scored
 * jobs and a user who has not yet met the loop the product is for — open a
 * match, compare it with the resume, tailor the resume. Derived from data,
 * like the wizard's steps: it shows while there is a match worth opening and
 * no comparison yet, and goes away with the first one. Pure — tested in
 * next-things.test.ts.
 */

import { t } from '../i18n/t';

export interface NextThingsFacts {
  /** The best-scored open posting that clears the primary search's floor; null when none does. */
  top: { id: number; title: string; company: string; fitScore: number } | null;
  /** Comparisons stored, of any resume with any posting. */
  comparisons: number;
  /** Resumes the user uploaded (the hidden scratch row not counted). */
  resumes: number;
  /** What a comparison costs, in one sentence (web/cost-hint.ts). */
  compareCost: string;
}

export interface NextThing {
  title: string;
  body: string;
  /** Where the step is done; null while an earlier step is still ahead. */
  href: string | null;
}

export function nextThings(f: NextThingsFacts): NextThing[] | null {
  if (f.comparisons > 0 || f.top === null) return null;
  const { id, title, company, fitScore } = f.top;
  return [
    { title: t('next.open.title'), body: t('next.open.body', { title, company, fit: fitScore }), href: `/jobs/${id}` },
    f.resumes === 0
      ? { title: t('next.compare.title'), body: t('next.compare.upload'), href: '/resumes' }
      : {
          title: t('next.compare.title'),
          // Two sentences side by side: the second is the cost line, worded where the cost is known.
          body: `${t('next.compare.body')} ${f.compareCost}`.trim(),
          href: `/jobs/${id}?tab=match`,
        },
    {
      title: t('next.tailor.title'),
      body: t('next.tailor.body'),
      href: null,
    },
  ];
}
