const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000];
const DEFAULT_USER_AGENT = 'job-hunter/0.1 (+https://github.com/nazboyko/job-hunter)';

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

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // Generic numeric entities: &#x2F; → '/', &#39; → "'", &#x27; → "'"
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/\s+/g, ' ')
    .trim();
}
