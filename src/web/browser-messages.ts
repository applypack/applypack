import { MESSAGE_KEYS, ownMessage, type MessageKey } from '../i18n/catalog';
import { SOURCE_LOCALE, intlTag, type Locale } from '../i18n/locale';
import { PSEUDO_CLOSE, PSEUDO_OPEN, isPseudo } from '../i18n/pseudo';

/*
 * The words the page modules write themselves (ADR 0061, stage 3): the
 * catalog's `browser.*` keys. Two ways they reach a browser, both built
 * here so they cannot drift:
 *
 *   - English, as public/i18n-en.mjs — a module written by
 *     `npm run i18n:browser` and committed, since public/ has no build step;
 *   - any other language, embedded in the page by layout.tsx as
 *     <script type="application/json" id="i18n-messages">, which
 *     public/i18n.mjs reads over the English.
 */

const BROWSER_PREFIX = 'browser.';

/** The keys the page modules word with, in the catalog's order. */
export const BROWSER_KEYS: readonly MessageKey[] = MESSAGE_KEYS.filter((key) => key.startsWith(BROWSER_PREFIX));

/** public/i18n-en.mjs, as the generator writes it. */
export function englishModule(): string {
  const lines = BROWSER_KEYS.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(ownMessage(SOURCE_LOCALE, key))},`);
  return [
    '/*',
    ' * The English of the page modules: the `browser.*` keys of src/i18n/catalog/en.json.',
    ' * Written by `npm run i18n:browser` (src/web/browser-messages.ts) — never by hand;',
    ' * src/web/i18n-browser.test.ts fails when it is behind the catalog.',
    ' */',
    '',
    'export const ENGLISH = {',
    ...lines,
    '};',
    '',
  ].join('\n');
}

const embeds = new Map<Locale, string | null>();

/**
 * The page's embed for `locale`: its language, the tag `Intl` formats with,
 * and every browser message in it — or null in English, which the module
 * carries itself. The pseudo-language embeds the English in ⟦ ⟧, as `t()`
 * marks it on the server. `<` is written `<`, so nothing in a message
 * can close the script element it travels in.
 */
export function browserMessagesJson(locale: Locale): string | null {
  if (locale === SOURCE_LOCALE) return null;
  let json = embeds.get(locale);
  if (json === undefined) {
    const pseudo = isPseudo(locale);
    const messages: Record<string, string> = {};
    for (const key of BROWSER_KEYS) {
      const message = ownMessage(locale, key) ?? ownMessage(SOURCE_LOCALE, key) ?? key;
      messages[key] = pseudo ? `${PSEUDO_OPEN}${message}${PSEUDO_CLOSE}` : message;
    }
    json = JSON.stringify({ locale, tag: intlTag(locale), messages }).replace(/</g, '\\u003c');
    embeds.set(locale, json);
  }
  return json;
}
