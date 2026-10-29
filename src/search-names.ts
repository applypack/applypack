import type { MessageKey } from './i18n/catalog';
import { ownMessage } from './i18n/catalog';
import { LOCALES, PSEUDO_LOCALE, type Locale } from './i18n/locale';
import { t } from './i18n/t';

/*
 * The names a search is born with (pure, #652). The first boot and "New
 * search" store them in English before anyone has chosen a language — the
 * first boot runs before the setup wizard asks — so they are worded on the
 * way out, as a stored value the code compares is (ADR 0061). A name the
 * person typed is theirs and is never touched.
 */
const BORN_AS = { 'My profile': 'settingsRoute.search.firstName', 'New profile': 'settingsRoute.search.newName' } as const satisfies Record<
  string,
  MessageKey
>;

/** The name a search is shown under: its own, or a born name in the reader's language. */
export function searchName(stored: string): string {
  return Object.hasOwn(BORN_AS, stored) ? t(BORN_AS[stored as keyof typeof BORN_AS]) : stored;
}

/**
 * Whether a search still carries the name it was born with — as stored, or as
 * shown in any language and saved back from the editor. Only such a search is
 * renamed after a resume's headline (resume/profile-draft.ts).
 */
export function isBornName(name: string): boolean {
  const locales = (Object.keys(LOCALES) as Locale[]).filter((l) => l !== PSEUDO_LOCALE);
  return Object.entries(BORN_AS).some(([stored, key]) => name === stored || locales.some((l) => ownMessage(l, key) === name));
}
