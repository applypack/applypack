const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000];
export const DEFAULT_USER_AGENT = 'applypack/0.11 (+https://github.com/nazboyko/applypack)';

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

      if (resp.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          await sleep(delay);
        }
        continue;
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Code points outside the Unicode range would make String.fromCodePoint throw. */
function safeCodePoint(n: number): string {
  return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
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
  return (
    decodeHtmlEntities(html)
      // Source newlines/tabs are not structure — block tags below are.
      .replace(/\s+/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<li(?:\s[^>]*)?>/gi, '\n• ')
      .replace(/<\/li>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(BLOCK_TAG_RE, '\n')
      // Only real tag shapes — "<3" or "a < b" in prose must survive.
      .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
