import { messageNodes, type MessageKey } from './catalog';
import { currentLocale, intlTag } from './locale';
import { formatMessage, partsToText, type MessageParams, type MessagePart } from './message';
import { PSEUDO_CLOSE, PSEUDO_OPEN, isPseudo } from './pseudo';

/*
 * The catalog's message for `key` in the language of the moment
 * (locale.ts:currentLocale) — English outside a request or a tick.
 */

/** The message as parts: text, and the inline elements a caller turns into markup (web/rich.tsx:tRich). */
export function tParts(key: MessageKey, params: MessageParams = {}): MessagePart[] {
  const locale = currentLocale();
  const parts = formatMessage(messageNodes(locale, key), params, intlTag(locale));
  return isPseudo(locale) ? [PSEUDO_OPEN, ...parts, PSEUDO_CLOSE] : parts;
}

/** The message as text; an inline element gives its words only. */
export function t(key: MessageKey, params?: MessageParams): string {
  return partsToText(tParts(key, params));
}
