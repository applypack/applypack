/*
 * What still stands between a new install and its first match, for the
 * Overview (#716): after "Skip setup" the page showed four zeros and a pause
 * line, and said nothing of what was missing. Pure — the route gathers the
 * facts. Tested in setup-left.test.ts.
 */
import type { MessageKey } from '../i18n/catalog';

export interface SetupLeftFacts {
  /** At least one AI engine can answer here. */
  aiReady: boolean;
  /** A resume the user uploaded (the launchers' hidden one does not count). */
  hasResume: boolean;
  /** The primary search names a stack or a role. */
  searchReady: boolean;
  fetchingEnabled: boolean;
}

export interface SetupLeftRow {
  key: 'ai' | 'resume' | 'search' | 'watch';
  done: boolean;
  title: MessageKey;
  hint: MessageKey;
  /** Where the row's title leads while it is open; null for the watch, which is a button. */
  href: string | null;
}

const PROFILE_STEP = '/welcome?step=profile';

/**
 * The four rows, or null once an AI, a resume and a search are all there.
 * A search someone paused on purpose is not a reason to bring the card back:
 * the pause has its own line.
 */
export function setupLeft(f: SetupLeftFacts): SetupLeftRow[] | null {
  if (f.aiReady && f.hasResume && f.searchReady) return null;
  return [
    { key: 'ai', done: f.aiReady, title: 'overview.left.ai', hint: 'overview.left.ai.hint', href: '/welcome?step=ai' },
    // With a search already written, a resume is only uploaded; without one, setup's step drafts the search from it.
    { key: 'resume', done: f.hasResume, title: 'overview.left.resume', hint: 'overview.left.resume.hint', href: f.searchReady ? '/resumes' : PROFILE_STEP },
    { key: 'search', done: f.searchReady, title: 'overview.left.search', hint: 'overview.left.search.hint', href: PROFILE_STEP },
    { key: 'watch', done: f.fetchingEnabled && f.aiReady && f.searchReady, title: 'overview.left.watch', hint: 'overview.left.watch.hint', href: null },
  ];
}

/** The watch can be switched on from the card once an AI and a search exist; before that the button would start nothing. */
export function canStartWatch(f: SetupLeftFacts): boolean {
  return f.aiReady && f.searchReady && !f.fetchingEnabled;
}
