import { APP_VERSION } from './app-version';

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

/** Code points outside the Unicode range would make String.fromCodePoint throw. */
/**
 * A numeric entity as its character, or nothing: `&#0;` is a NUL, which
 * Postgres refuses in a text column (one such posting failed the whole
 * insert), and a surrogate on its own is half a character.
 */
function safeCodePoint(n: number): string {
  return n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : '';
}

/**
 * Decode the HTML entities job feeds actually emit. `&amp;` is decoded LAST,
 * so double-escaped input ("&amp;lt;") yields the literal "&lt;" instead of
 * decoding twice and materialising a phantom tag.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // Generic numeric entities: &#x2F; → '/', &#39; → "'", &#x27; → "'"
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, '&');
}

/** Tags that end a line of text; each boundary becomes a newline. */
const BLOCK_TAG_RE =
  /<\/?(?:p|div|section|article|header|footer|main|aside|table|thead|tbody|tr|ul|ol|dl|dt|dd|blockquote|figure|figcaption|form|fieldset|pre|h[1-6])(?:\s[^>]*)?\/?>/gi;

/**
 * HTML → readable plaintext. Entities are decoded FIRST because some ATS
 * feeds (Greenhouse) ship the whole body HTML-escaped — stripping before
 * decoding used to let those tags rematerialise into the stored text.
 * Raw newlines in the source are treated as whitespace (HTML semantics);
 * line structure is rebuilt from block tags, <br> and <li> instead, so
 * descriptions keep their paragraphs and bullet lists.
 */
export function stripHtml(html: string): string {
  // Source newlines/tabs are not structure — block tags below are.
  let text = decodeHtmlEntities(html).replace(/\s+/g, ' ');
  text = replaceUpTo(text, lastIndexOf(text, /-->/g), /<!--[\s\S]*?-->/g, ' ');
  // Every pattern given to this one ends in `>`.
  const tags = (re: RegExp, to: string): void => {
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
  // Only real tag shapes — "<3" or "a < b" in prose must survive.
  tags(/<\/?[a-zA-Z][^>]*>/g, ' ');
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
function replaceUpTo(text: string, end: number, re: RegExp, to: string): string {
  return end === 0 ? text : text.slice(0, end).replace(re, to) + text.slice(end);
}
