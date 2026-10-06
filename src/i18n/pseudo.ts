import { PSEUDO_LOCALE, currentLocale, type Locale } from './locale';

/*
 * The pseudo-language (ADR 0061): English with everything that went through
 * the catalog or the format module wrapped in ⟦ ⟧. A page rendered in it
 * shows, by what is left outside the brackets, the English that is still
 * written into the code — `hardcodedText` reads that off the HTML, and the
 * route smoke adds it up over every page as the count each translation stage
 * has to bring down. Never offered to a person.
 */

export const PSEUDO_OPEN = '⟦';
export const PSEUDO_CLOSE = '⟧';

export function isPseudo(locale: Locale = currentLocale()): boolean {
  return locale === PSEUDO_LOCALE;
}

/** A value the format module wrote (a date, a number, a place name): marked as done, like a message. */
export function marked(text: string): string {
  return isPseudo() ? `${PSEUDO_OPEN}${text}${PSEUDO_CLOSE}` : text;
}

/** Elements whose text is not the interface's: code, drawings, markup for machines. */
const SKIPPED = new Set(['svg', 'code', 'pre', 'kbd', 'samp']);
/** Elements whose contents are not markup at all: read past, up to their own closing tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea']);
/** Elements with no closing tag. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** Phrasing inside a sentence: crossing one of these does not end the run of text. */
const INLINE = new Set(['a', 'b', 'strong', 'em', 'i', 'abbr', 'time', 'u', 'mark', 'sub', 'sup', 'small', 'br', 'wbr']);
/** The attributes a person reads or hears. */
const WORDED_ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'];

const TOKEN = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</giy;
const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
/** Two letters in a row is a word ("of", "ms"); a lone letter is a unit or an initial. */
const HAS_WORD = /[A-Za-z]{2,}/;

function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITY[m] ?? m);
}

function attribute(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

/** The part of `text` outside the pseudo brackets; `depth` carries an open bracket across elements. */
function outside(text: string, depth: number): { kept: string; depth: number } {
  let kept = '';
  for (const ch of text) {
    if (ch === PSEUDO_OPEN) depth++;
    else if (ch === PSEUDO_CLOSE) depth = Math.max(0, depth - 1);
    else if (depth === 0) kept += ch;
  }
  return { kept, depth };
}

/**
 * The English still written into the code, read off a page rendered in the
 * pseudo-language: each run of text (and each title, aria-label, placeholder
 * and alt) that holds a word outside the brackets. Skipped: scripts, styles,
 * drawings, code, a textarea's contents, and any element marked
 * `translate="no"` or `lang="en"` — what a posting, a resume or a model said
 * is data, and says so in the markup.
 */
export function hardcodedText(html: string): string[] {
  const found: string[] = [];
  /** Open elements, innermost last, with whether the text inside is skipped. */
  const stack: { name: string; skip: boolean }[] = [];
  let run = '';
  let depth = 0;

  const skipping = (): boolean => stack.some((e) => e.skip);
  const keep = (text: string): void => {
    const words = decode(text).replace(/\s+/g, ' ').trim();
    if (HAS_WORD.test(words)) found.push(words);
  };
  const flush = (): void => {
    keep(run);
    run = '';
  };

  const lower = html.toLowerCase();
  const token = new RegExp(TOKEN.source, TOKEN.flags);
  for (let m = token.exec(html); m; m = token.exec(html)) {
    const name = m[2]?.toLowerCase();
    if (!name) {
      // A comment and the doctype are not the page's text; anything else is.
      if (m[0].startsWith('<!') || skipping()) continue;
      const read = outside(m[0], depth);
      depth = read.depth;
      run += read.kept;
      continue;
    }
    if (!INLINE.has(name)) flush();
    if (m[1]) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const attrs = m[3] ?? '';
    const data = SKIPPED.has(name) || attribute(attrs, 'translate') === 'no' || attribute(attrs, 'lang') === 'en';
    if (!skipping() && !data) {
      for (const attr of WORDED_ATTRIBUTES) {
        const value = attribute(attrs, attr);
        if (value !== null) keep(outside(value, 0).kept);
      }
    }
    if (RAW_TEXT.has(name)) {
      const end = lower.indexOf(`</${name}`, token.lastIndex);
      token.lastIndex = end < 0 ? html.length : end;
    } else if (!VOID.has(name) && !attrs.trimEnd().endsWith('/')) {
      stack.push({ name, skip: data });
    }
  }
  flush();
  return found;
}
