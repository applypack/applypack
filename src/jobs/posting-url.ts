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
