import type { NavKey } from './layout';

/** The menu entry a run's progress page belongs to: the page it returns to, never Tailor resume for every run. */
const BY_PATH: readonly [string, NavKey][] = [
  ['/jobs', 'jobs'],
  ['/resumes', 'resumes'],
  ['/screen', 'screen'],
  ['/letter', 'letter'],
  ['/target', 'target'],
];

export function runNav(backUrl: string): NavKey | undefined {
  return BY_PATH.find(([path]) => backUrl === path || backUrl.startsWith(`${path}/`) || backUrl.startsWith(`${path}?`))?.[1];
}
