import en from './catalog/en.json';
import uk from './catalog/uk.json';
import es from './catalog/es.json';
import fr from './catalog/fr.json';
import { PSEUDO_LOCALE, SOURCE_LOCALE, type Locale } from './locale';
import { parseMessage, type MessageNode } from './message';

/*
 * One flat JSON file per language (ADR 0061). `en.json` is the source: its
 * keys are the only keys there are, and the type of a key is read off it, so
 * a `t('nav.jbos')` does not compile. catalog.test.ts fails a language that
 * lacks a key, so a string ships with its translations; reading the English
 * message for a missing one is a safety net, not a way of working.
 */

export type MessageKey = keyof typeof en;

type Catalog = Partial<Record<MessageKey, string>>;

const CATALOGS: Record<Locale, Catalog> = {
  en,
  uk,
  es,
  fr,
  // English under another name; t() marks what comes out of it (pseudo.ts).
  [PSEUDO_LOCALE]: en,
};

export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];

/** The language's own wording, or undefined where it has none yet. */
export function ownMessage(locale: Locale, key: MessageKey): string | undefined {
  return CATALOGS[locale][key];
}

/** Every key a catalog file holds, the ones the source does not know included — for the parity test. */
export function catalogKeys(locale: Locale): string[] {
  return Object.keys(CATALOGS[locale]);
}

const parsed = new Map<string, MessageNode[]>();

/** The message as parsed nodes, in `locale` or — as a safety net — in English. */
export function messageNodes(locale: Locale, key: MessageKey): MessageNode[] {
  const id = `${locale}\n${key}`;
  let nodes = parsed.get(id);
  if (!nodes) {
    nodes = parseMessage(ownMessage(locale, key) ?? ownMessage(SOURCE_LOCALE, key) ?? key);
    parsed.set(id, nodes);
  }
  return nodes;
}
