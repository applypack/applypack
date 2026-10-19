import type { MessageKey } from '../i18n/catalog';
import type { NavKey } from './layout';

/** The menu entry a run's progress page belongs to: the page it returns to, never Tailor resume for every run. */
const BY_PATH: readonly [string, NavKey][] = [
  ['/jobs', 'jobs'],
  ['/resumes', 'resumes'],
  ['/screen', 'screen'],
  ['/letter', 'letter'],
  ['/target', 'target'],
];

/** The page itself, a page under it, or the page with a query — never a lookalike ("/jobsearch"). */
const under = (url: string, path: string): boolean => url === path || url.startsWith(`${path}/`) || url.startsWith(`${path}?`);

export function runNav(backUrl: string): NavKey | undefined {
  return BY_PATH.find(([path]) => under(backUrl, path))?.[1];
}

/** Where the result lands, said under the steps, by where the run came from; a job's page is the default (#580). */
const LANDS_ON: readonly [string, MessageKey][] = [
  ['/screen', 'target.run.closeScreening'],
  ['/jobs/import', 'target.run.closeImport'],
  ['/settings', 'target.run.closeSettings'],
  ['/welcome', 'target.run.closeSetup'],
  ['/resumes', 'target.run.closeResume'],
];

export function runLandsOn(backUrl: string): MessageKey {
  // Jobs itself is where a scoring pass lands; a job's own page is the default below.
  if (backUrl === '/jobs' || backUrl.startsWith('/jobs?')) return 'target.run.closeImport';
  return LANDS_ON.find(([path]) => under(backUrl, path))?.[1] ?? 'target.run.closeJob';
}
