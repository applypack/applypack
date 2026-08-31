import { fetchWithRetry, HttpError, stripHtml } from '../http';
import { MIN_DESCRIPTION_CHARS } from './manual-job';

/*
 * Fetch one user-provided posting URL and turn the page into plain text for
 * the manual-job flow (/letter). This is a single page GET at the user's
 * explicit request — the same class as the liveness ladder's rung 2
 * (ADR 0016), not a crawler. ADR 0005 hosts are refused outright, and a
 * page that answers with a bot check fails honestly instead of being worked
 * around. The guards are pure and tested; only fetchPostingText does I/O.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_TEXT_CHARS = 30_000;

/** ADR 0005: never scraped — not even one page at a time. */
export const BLOCKED_POSTING_HOSTS = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'workday.com',
  'myworkdayjobs.com',
  'wellfound.com',
  'dice.com',
];

const CHALLENGE_MARKERS =
  /just a moment|checking your browser|cloudflare|are you a (?:robot|human)|captcha|access denied|enable javascript and cookies/i;

/**
 * SSRF guard. ADR 0016 keeps the liveness ladder on fixed hosts; this flow
 * takes an arbitrary URL, so the private address space is refused instead —
 * before the request AND again on the post-redirect URL, since a public host
 * can redirect into 169.254.169.254 and hand cloud metadata to the model.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '::' || host === '0.0.0.0') return true;
  // IPv6 link-local (fe80::/10 → fe80-febf) and unique-local (fc00::/7 → fc00-fdff).
  if (/^(?:fe[89ab][0-9a-f]|f[cd][0-9a-f]{2}):/.test(host)) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, incl. the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
  );
}

export type PostingUrlResult = { ok: true; text: string } | { ok: false; error: string };

export function checkPostingUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'That does not look like a URL.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Only http(s) posting URLs can be fetched.' };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_POSTING_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) {
    return {
      ok: false,
      error: 'That site is never fetched here (ADR 0005) — paste the posting text instead.',
    };
  }
  if (isPrivateHost(host)) {
    return { ok: false, error: 'Only public posting URLs can be fetched.' };
  }
  return { ok: true, url };
}

export function postingTextFromHtml(html: string): PostingUrlResult {
  const text = stripHtml(html).trim();
  if (CHALLENGE_MARKERS.test(text.slice(0, 600))) {
    return { ok: false, error: 'The page answered with a bot check — paste the posting text instead.' };
  }
  if (text.length < MIN_DESCRIPTION_CHARS) {
    return {
      ok: false,
      error:
        'Could not read a posting from that page (it may need JavaScript) — paste the text instead.',
    };
  }
  return { ok: true, text: text.slice(0, MAX_TEXT_CHARS) };
}

export async function fetchPostingText(raw: string): Promise<PostingUrlResult> {
  const checked = checkPostingUrl(raw);
  if (!checked.ok) return checked;
  try {
    const res = await fetchWithRetry(checked.url.toString(), { timeoutMs: FETCH_TIMEOUT_MS });
    // Redirects are followed, so the host that actually answered is re-checked.
    const landed = checkPostingUrl(res.url || checked.url.toString());
    if (!landed.ok) return landed;
    return postingTextFromHtml(await res.text());
  } catch (err) {
    if (err instanceof HttpError && (err.status === 403 || err.status === 429 || err.status === 503)) {
      return { ok: false, error: 'The page answered with a bot check — paste the posting text instead.' };
    }
    return {
      ok: false,
      error: `Could not fetch that URL (${err instanceof Error ? err.message : 'unknown error'}) — paste the text instead.`,
    };
  }
}
