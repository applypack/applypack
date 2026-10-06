import { t } from '../i18n/t';

/*
 * The job page's tabs (`/jobs/:id?tab=…`). Pure — tested in job-tabs.test.ts.
 * A tab is a link, never client state: the server renders one tab's cards, the
 * rail (status, details, application tracking) rides on all of them.
 */

export const JOB_TABS = ['posting', 'match', 'letter', 'verify', 'pack'] as const;
export type JobTab = (typeof JOB_TABS)[number];

const DEFAULT_TAB: JobTab = 'posting';

/** A query or form value as the route hands it over: absent, empty, or a string. */
type Raw = string | null | undefined;

/**
 * Which tab a request means. An explicit `tab` wins; without one, `match=`
 * means the comparison and `letter=` the letter — so every link written before
 * the tabs existed (`?match=12#resume-match`, `?letter=3#cover-letter`) still
 * lands on the card it points at. Anything else, an unknown `tab` included, is
 * the posting. The POST routes read their hidden `tab` through this too, so
 * nothing unvalidated reaches a redirect.
 */
export function resolveJobTab(query: { tab?: Raw; match?: Raw; letter?: Raw }): JobTab {
  const asked = JOB_TABS.find((tab) => tab === query.tab);
  if (asked) return asked;
  if (query.match) return 'match';
  if (query.letter) return 'letter';
  return DEFAULT_TAB;
}

/**
 * A job page URL. The default tab stays out of it, so `/jobs/12` is still the
 * page's address; `params` (a `match` or `letter` id) ride along, and an
 * anchor lands on a card inside the tab.
 */
export function jobHref(id: number, tab: JobTab = DEFAULT_TAB, params: Record<string, string | number> = {}, anchor = ''): string {
  const usp = new URLSearchParams();
  if (tab !== DEFAULT_TAB) usp.set('tab', tab);
  for (const [k, v] of Object.entries(params)) usp.set(k, String(v));
  const qs = usp.toString();
  return `/jobs/${id}${qs ? `?${qs}` : ''}${anchor ? `#${anchor}` : ''}`;
}

/** What each tab's label carries: a tab says what already exists behind it. */
export interface JobTabFacts {
  /** The score of the comparison the page would show; null = none yet. */
  matchScore: number | null;
  letters: number;
  /** The latest verification's verdict; null = never checked. */
  verdict: string | null;
  /** Where the application pack stands (pack/view.ts:packFact); null = none. */
  pack: string | null;
}

/** "Resume match · 72", "Cover letter · 1", "Is it real? · likely real", "Application pack · ready" — or the bare name while there is nothing yet. */
export function jobTabLabels(facts: JobTabFacts): { tab: JobTab; label: string }[] {
  // The verdict is the verifier's own word, shown as it wrote it.
  const verdict = facts.verdict ? facts.verdict.replace(/_/g, ' ').toLowerCase() : null;
  return [
    { tab: 'posting', label: t('job.tab.posting') },
    { tab: 'match', label: facts.matchScore === null || facts.matchScore === 0 ? t('job.tab.match') : t('job.tab.matchScore', { score: facts.matchScore }) },
    { tab: 'letter', label: facts.letters === 0 ? t('job.tab.letter') : t('job.tab.letterCount', { n: facts.letters }) },
    { tab: 'verify', label: verdict === null ? t('job.tab.verify') : t('job.tab.verifyVerdict', { verdict }) },
    // The pack's fact (pack/view.ts:packFact) is still the worker's English word; the tab name is ours.
    { tab: 'pack', label: facts.pack === null ? t('job.tab.pack') : t('job.tab.packFact', { fact: facts.pack }) },
  ];
}
