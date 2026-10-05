import type { Child } from 'hono/jsx';
import type { MessageKey } from '../i18n/catalog';
import type { MessageParams, MessagePart } from '../i18n/message';
import { tParts } from '../i18n/t';

/** What each tag of a message becomes: `{ link: (words) => <a href="…">{words}</a> }`. */
type TagRenderers = Record<string, (children: Child[]) => Child>;

function render(parts: readonly MessagePart[], tags: TagRenderers): Child[] {
  return parts.flatMap((part) => {
    if (typeof part === 'string') return [part];
    const children = render(part.children, tags);
    // A tag the caller did not name keeps its words: the sentence still reads.
    return tags[part.tag] ? [tags[part.tag]!(children)] : children;
  });
}

/**
 * A catalog message with inline elements (ADR 0061), as children for a page:
 * the sentence stays one message — a translator moves the link to where their
 * grammar wants it — and the markup stays in the page that calls this.
 */
export function tRich(key: MessageKey, params: MessageParams, tags: TagRenderers): Child[] {
  return render(tParts(key, params), tags);
}
