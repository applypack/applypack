import type { MessageKey } from '../i18n/catalog';
import type { MessageParams, MessagePart } from '../i18n/message';
import { tParts } from '../i18n/t';

/*
 * A catalog message in a chat channel's own markup (ADR 0061, stage 4). The
 * channel escapes every run of text — the catalog's words as much as the
 * values put into them, because a translation may carry a character the
 * markup reserves — and writes each inline element of the message
 * (`<b>…</b>`) its own way. Pure.
 */

/** What a channel does with text, and with each inline element by name. */
export interface ChannelMarkup {
  escape: (text: string) => string;
  tags: Readonly<Record<string, (inner: string) => string>>;
}

function render(parts: readonly MessagePart[], markup: ChannelMarkup): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return markup.escape(part);
      const inner = render(part.children, markup);
      // An element the channel does not write keeps its words, as tRich does on a page.
      return Object.hasOwn(markup.tags, part.tag) ? markup.tags[part.tag]!(inner) : inner;
    })
    .join('');
}

/** The message in the language of the moment, ready to send on `markup`'s channel. */
export function tMarkup(markup: ChannelMarkup, key: MessageKey, params: MessageParams = {}): string {
  return render(tParts(key, params), markup);
}
