import { APP_VERSION } from './app-version';
import { namedEntity } from './html-entities';

const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000];
/**
 * A 429 that names a short wait is waited out and asked again; a longer one
 * is not worth holding the tick for, and fails as a rate limit the source
 * health records (audit FETCH-5).
 */
const MAX_RETRY_AFTER_MS = 10_000;
// major.minor from package.json so the UA stops rotting on version bumps
// (it sat on 0.1 for ten releases).
const packageMajorMinor = (): string => APP_VERSION.split('.').slice(0, 2).join('.');

export const DEFAULT_USER_AGENT = `applypack/${packageMajorMinor()} (+https://github.com/applypack/applypack)`;

export interface FetchOptions {
  timeoutMs?: number;
  init?: RequestInit;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(options.init?.headers);
      if (!headers.has('User-Agent') && !headers.has('user-agent')) {
        headers.set('User-Agent', DEFAULT_USER_AGENT);
      }
      const resp = await fetch(url, {
        ...options.init,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.status === 429 && attempt < RETRY_DELAYS_MS.length) {
        const wait = retryAfterMs(resp.headers.get('retry-after'), Date.now());
        if (wait !== null && wait <= MAX_RETRY_AFTER_MS) {
          await resp.body?.cancel().catch(() => undefined);
          await sleep(wait);
          continue;
        }
      }

      if (resp.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          await sleep(delay);
        }
        continue;
      }

      // A caller that asked for redirects unfollowed wants the 3xx back to
      // judge the next hop itself (posting-url.ts:fetchPublicHops); a 304 is
      // still the conditional answer and still thrown (ADR 0035).
      if (options.init?.redirect === 'manual' && REDIRECT_STATUSES.has(resp.status)) {
        return resp;
      }

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new HttpError(
          `HTTP ${resp.status} for ${url}`,
          resp.status,
          url,
          body.slice(0, 500),
        );
      }
      return resp;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const isHttp = err instanceof HttpError;
      // Don't retry HTTP 4xx (those are thrown above only for non-ok non-5xx).
      if (isHttp && err.status < 500) {
        throw err;
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          await sleep(delay);
        }
        continue;
      }
      // Last attempt failed.
      if (isAbort) {
        throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  // Should be unreachable.
  throw lastError instanceof Error
    ? lastError
    : new Error(`fetchWithRetry exhausted retries for ${url}`);
}

/** `Retry-After` in milliseconds from now: seconds or an HTTP date; null when it says neither. */
export function retryAfterMs(header: string | null, now: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A numeric entity as its character, or nothing: `&#0;` is a NUL, which
 * Postgres refuses in a text column (one such posting failed the whole
 * insert), a surrogate on its own is half a character, and a code point
 * past the Unicode range would make String.fromCodePoint throw.
 */
function safeCodePoint(n: number): string {
  return n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : '';
}

/** A character reference: decimal, hex, or a name (the longest HTML knows has 31 characters). */
const ENTITY_RE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]{0,31}));/g;

/**
 * One layer of HTML entities decoded, in one pass: each reference becomes
 * its character and what that character spells is not read again, so
 * "&amp;lt;" yields the literal "&lt;" instead of a phantom tag (gotcha
 * 12). A name `html-entities.ts` does not know stays as written.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(ENTITY_RE, (whole: string, dec?: string, hex?: string, name?: string) => {
    if (dec !== undefined) return safeCodePoint(parseInt(dec, 10));
    if (hex !== undefined) return safeCodePoint(parseInt(hex, 16));
    return namedEntity(name ?? '') ?? whole;
  });
}

/** Tags that end a line of text; each boundary becomes a newline. */
const BLOCK_TAG_RE =
  /<\/?(?:p|div|section|article|header|footer|main|aside|table|thead|tbody|tr|ul|ol|dl|dt|dd|blockquote|figure|figcaption|form|fieldset|pre|h[1-6])(?:\s[^>]*)?\/?>/gi;

/**
 * Any other tag, its name captured. The name ends where a letter or digit
 * does, so the two runs never trade characters back and forth.
 */
const ANY_TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?:[^a-zA-Z0-9>][^>]*)?>/g;

/**
 * Phrasing elements: a browser draws them inside the line, with no space of
 * their own.
 */
const INLINE_TAGS: ReadonlySet<string> = new Set(
  'a abbr b bdi bdo cite code data del dfn em font i ins kbd mark q s samp small span strike strong sub sup time tt u var'.split(' '),
);

/**
 * Where an inline tag stood, until the characters around it are known. A
 * NUL, because no decoded entity can be one; a raw NUL in a feed goes the
 * same way, which Postgres would have refused anyway.
 */
const INLINE_GAP = '\u0000';
/** Punctuation that closes on the word before it: "AWS.", "Node.js,", "Google's", "full-time". */
const GAP_BEFORE_PUNCTUATION_RE = /\u0000+(?=[\p{Pe}\p{Pf}\p{Po}\p{Pd}])/gu;
/** Punctuation that opens on the word after it: "(remote)", "$100k", "pre-seed". */
const GAP_AFTER_PUNCTUATION_RE = /(?<=[\p{Ps}\p{Pi}\p{Pd}\p{Sc}'"\/])\u0000+/gu;
const GAP_RE = /\u0000+/g;

/**
 * HTML → readable plaintext, in three steps:
 *
 * 1. The markup's own layer of entities is decoded, because some feeds ship
 *    the body HTML-escaped — Greenhouse every one, Arbeitnow some with a
 *    footer of real tags after it — and stripping first used to leave those
 *    tags in the stored text.
 * 2. The tags go. Raw newlines are whitespace (HTML semantics); the lines are
 *    rebuilt from block tags, <br> and <li>, so descriptions keep their
 *    paragraphs and bullet lists. Any other tag leaves a space, except an
 *    inline one next to punctuation: "<b>AWS</b>." is "AWS.", as a browser
 *    draws it. Between two words it stays a space: a span a page styles as a
 *    block would otherwise glue them.
 * 3. The text's own entities are decoded: what the escaped body escaped once
 *    more ("&amp;nbsp;", "&amp;amp;") and what a plain one carried. After the
 *    tags, so a "<" they spell stays a character of the text.
 *
 * Each layer is decoded once. The output is not markup any more, and is never
 * read by this again (gotcha 12).
 */
export function stripHtml(html: string): string {
  // Source newlines/tabs are not structure — block tags below are.
  let text = decodeHtmlEntities(html).replace(/\s+/g, ' ');
  text = replaceUpTo(text, lastIndexOf(text, /-->/g), /<!--[\s\S]*?-->/g, ' ');
  // Every pattern given to this one ends in `>`.
  const tags = (re: RegExp, to: string | ((tag: string, name: string) => string)): void => {
    text = replaceUpTo(text, lastIndexOf(text, />/g), re, to);
  };
  // Markup declarations — `<!DOCTYPE html>` and friends. The tag regex
  // below needs a letter after `<`, so these used to survive it and show
  // up at the head of every description taken from a whole page.
  tags(/<![^>]*>/g, ' ');
  text = dropElements(dropElements(text, 'script'), 'style');
  tags(/<li(?:\s[^>]*)?>/gi, '\n• ');
  tags(/<\/li>/gi, ' ');
  tags(/<br\s*\/?>/gi, '\n');
  tags(BLOCK_TAG_RE, '\n');
  // Only real tag shapes — "<3" or "a < b" in prose must survive. One pass
  // for inline and other tags alike: a tag a feed cut short ('<br style="x
  // -----<p>…<a href="…">') then runs to the next ">", as a browser reads it.
  tags(ANY_TAG_RE, (_tag, name) => (INLINE_TAGS.has(name.toLowerCase()) ? INLINE_GAP : ' '));
  return decodeHtmlEntities(text)
    .replace(GAP_BEFORE_PUNCTUATION_RE, '')
    .replace(GAP_AFTER_PUNCTUATION_RE, '')
    .replace(GAP_RE, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Tags nothing closes. */
const VOID_TAGS: ReadonlySet<string> = new Set(['img', 'br', 'hr', 'wbr', 'input']);

/**
 * Inline markup out of a short field, or out of prose whose lines are
 * already lines: every tag whose name the text also closes somewhere, and
 * the ones nothing closes (`<img>`, `<br>`). Newlines stay where they are —
 * `stripHtml` treats them as whitespace and rebuilds the lines from block
 * tags, which flattens a plain-text posting that holds one link. A "<" that
 * is not markup stays as well: "a < b", "<3", "C++ <-> Rust", and
 * "a<b and c>d", which has a tag's shape and closes nothing. Entities are
 * decoded before the tags go and once more after, one layer each, as in
 * stripHtml (gotcha 12). Every step is one pass over the text.
 */
export function stripInlineTags(text: string): string {
  const decoded = decodeHtmlEntities(text);
  const closed = new Set<string>();
  for (const closer of decoded.matchAll(/<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/g)) closed.add(closer[1]!.toLowerCase());
  const body = closed.has('script') || closed.has('style') ? dropElements(dropElements(decoded, 'script'), 'style') : decoded;
  const bare = body.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s[^<>]*)?\/?>/g, (tag: string, name: string) => {
    const lower = name.toLowerCase();
    if (!closed.has(lower) && !VOID_TAGS.has(lower)) return tag;
    return lower === 'br' || lower === 'hr' ? ' ' : '';
  });
  // The text's own entities, once the tags are out — as stripHtml's step 3.
  return decodeHtmlEntities(bare);
}

/**
 * `<tag …>…</tag>` out of the text, each from its opener to the first closer
 * after it — what `/<tag[^>]*>[\s\S]*?<\/tag>/gi` matches, found by walking
 * forward once. As a regex, a run of openers before one closer scanned to
 * that closer from every opener in turn.
 */
function dropElements(text: string, tag: 'script' | 'style'): string {
  const opener = new RegExp(`<${tag}`, 'gi');
  const closer = new RegExp(`</${tag}>`, 'gi');
  let out = '';
  let from = 0;
  for (;;) {
    opener.lastIndex = from;
    const start = opener.exec(text);
    const openEnd = start ? text.indexOf('>', start.index) : -1;
    if (!start || openEnd === -1) break;
    closer.lastIndex = openEnd + 1;
    const end = closer.exec(text);
    // No closer after this opener means none after any later one.
    if (!end) break;
    out += `${text.slice(from, start.index)} `;
    from = end.index + end[0].length;
  }
  return out + text.slice(from);
}

/** Where the last match of `closer` ends, or 0 when there is none. */
function lastIndexOf(text: string, closer: RegExp): number {
  let end = 0;
  for (const match of text.matchAll(closer)) end = match.index + match[0].length;
  return end;
}

/**
 * `re` over the text up to `end` only. Each pattern it is given ends in a
 * closer (`-->` or `>`), so nothing past the last closer can
 * match — and without the cut, every opener in a run that is never closed
 * scans to the end of the text on its own: 300 kB of `<a ` took nine
 * seconds, which a posting from outside can be.
 */
function replaceUpTo(text: string, end: number, re: RegExp, to: string | ((match: string, name: string) => string)): string {
  if (end === 0) return text;
  const head = text.slice(0, end);
  return (typeof to === 'string' ? head.replace(re, to) : head.replace(re, to)) + text.slice(end);
}
