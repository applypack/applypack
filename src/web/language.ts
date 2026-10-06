import { AsyncLocalStorage } from 'node:async_hooks';
import { SOURCE_LOCALE, isLocale, matchAcceptLanguage, offeredLocales, type Locale } from '../i18n/locale';

/*
 * Which language a request is answered in, and what the page around it needs
 * to offer another (ADR 0061). The language never changes by itself:
 *
 *   - a stored choice is the answer, whatever the browser says;
 *   - with none stored, a first run (setup not finished) opens in the
 *     browser's language when it is offered, and finishing setup stores it;
 *   - with none stored on an install already set up, the page stays English
 *     and carries one line, in the browser's language, offering the switch —
 *     until the person answers it either way.
 */

export interface LanguageChoice {
  locale: Locale;
  /** The offered language the browser prefers to English, on an install that never chose; else null. */
  invite: Locale | null;
}

export function resolveLanguage(
  input: { stored: string | null; setupCompleted: boolean; acceptLanguage: string | undefined },
  offered: readonly Locale[] = offeredLocales(),
): LanguageChoice {
  if (isLocale(input.stored)) return { locale: input.stored, invite: null };
  const browser = matchAcceptLanguage(input.acceptLanguage, offered);
  if (!input.setupCompleted) return { locale: browser ?? SOURCE_LOCALE, invite: null };
  return { locale: SOURCE_LOCALE, invite: browser !== null && browser !== SOURCE_LOCALE ? browser : null };
}

interface LanguagePage {
  invite: Locale | null;
  /** Where the switcher returns to: the page it was pressed on, when that page is one a GET can draw again. */
  back: string;
}

const page = new AsyncLocalStorage<LanguagePage>();

const NO_PAGE: LanguagePage = { invite: null, back: '/' };

export function withLanguagePage<T>(value: LanguagePage, fn: () => T): T {
  return page.run(value, fn);
}

/** Sync, for the layout; outside a request there is nothing to offer. */
export function languagePage(): LanguagePage {
  return page.getStore() ?? NO_PAGE;
}

/** The switcher's way back for a request: its own path and query for a GET, the Overview for anything else. */
export function backFor(method: string, url: string): string {
  if (method !== 'GET') return NO_PAGE.back;
  const { pathname, search } = new URL(url);
  return `${pathname}${search}`;
}
