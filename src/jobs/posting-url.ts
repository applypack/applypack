import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { fetchWithRetry, HttpError, stripHtml, type FetchOptions } from '../http';
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
const BLOCKED_POSTING_HOSTS = [
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

/*
 * Ashby draws its job pages in the browser, so a GET returns a shell with no
 * posting in it. Its public board API — the one fetchers/ashby.ts reads every
 * tick — carries the same listing as JSON, so an Ashby URL is answered from
 * there: a job page by its id, a board root by the title the caller is after.
 */
const ASHBY_HOST = 'jobs.ashbyhq.com';
const ASHBY_API = 'https://api.ashbyhq.com/posting-api/job-board/';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AshbyPostingSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      location: z.string().nullable().optional(),
      descriptionHtml: z.string().nullable().optional(),
    }),
  ),
});
type AshbyPosting = z.infer<typeof AshbyPostingSchema>['jobs'][number];

export interface AshbyRef {
  org: string;
  /** Null for the board's root, which lists every role. */
  jobId: string | null;
}

export function parseAshbyUrl(url: URL): AshbyRef | null {
  if (url.hostname.toLowerCase() !== ASHBY_HOST) return null;
  const [org, second] = url.pathname.split('/').filter(Boolean);
  if (!org) return null;
  return { org, jobId: second && UUID_RE.test(second) ? second : null };
}

/** Which listing the URL means: the job by id, else the one titled like the posting; an honest error otherwise. */
export function pickAshbyJob<T extends { id: string; title: string }>(
  jobs: T[],
  ref: AshbyRef,
  title: string | undefined,
): { ok: true; job: T } | { ok: false; error: string } {
  if (ref.jobId) {
    const job = jobs.find((j) => j.id === ref.jobId);
    return job ? { ok: true, job } : { ok: false, error: "That listing is no longer on the company's Ashby board — it may have closed." };
  }
  const wanted = title?.trim().toLowerCase();
  const byTitle = wanted ? jobs.filter((j) => j.title.trim().toLowerCase() === wanted) : [];
  const [only] = byTitle;
  if (byTitle.length === 1 && only) return { ok: true, job: only };
  return {
    ok: false,
    error:
      byTitle.length > 1
        ? `The board lists ${byTitle.length} roles titled "${title}" — paste the job page URL instead.`
        : `That is the board's index (${jobs.length} roles), not a job page — paste the job page URL instead.`,
  };
}

/** The listing as the text a posting page would have given: title, place, body. */
export function ashbyPostingText(job: Pick<AshbyPosting, 'title' | 'location' | 'descriptionHtml'>): PostingUrlResult {
  return postingText([job.title, job.location ?? '', '', stripHtml(job.descriptionHtml ?? '').trim()].join('\n').trim());
}

/*
 * SSRF guard. ADR 0016 keeps the liveness ladder on fixed hosts; every flow
 * that takes an arbitrary URL — a pasted posting, a watched feed or careers
 * page, a Teamtailor custom domain — goes through this one guard. Three
 * layers, because a name check alone was bypassed by `localhost.`,
 * `[::ffff:169.254.169.254]` and `127.0.0.1.nip.io` (audit 2026-09-10):
 *
 * 1. checkPostingUrl — pure: scheme, credentials, ADR 0005 hosts, private
 *    names and private address literals in every spelling.
 * 2. resolvesToPublic — the addresses the name resolves to, every one of
 *    them public, before a connection is made.
 * 3. fetchPublicHops — redirects are never followed blindly: each hop is a
 *    new URL through layers 1 and 2, at most MAX_REDIRECTS of them, and a
 *    refused hop is never requested.
 *
 * Residual: a name whose records change between our lookup and the
 * socket's (DNS rebinding) is not pinned. Closing that needs a custom
 * dispatcher, which is a dependency this project does not carry.
 */

/** A private, loopback, link-local or otherwise non-routable address, in IPv4 or IPv6 spelling. */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(addr);
  if (family === 4) return isPrivateV4(addr);
  if (family !== 6) return false;
  if (addr === '::1' || addr === '::') return true;
  // IPv4 embedded in IPv6 — mapped (::ffff:a.b.c.d, which the URL parser
  // writes as ::ffff:a9fe:a9fe) and NAT64's well-known prefix (64:ff9b::/96).
  const embedded = /^(?:::ffff:|64:ff9b::)(.+)$/.exec(addr)?.[1];
  if (embedded) {
    if (isIP(embedded) === 4) return isPrivateV4(embedded);
    const pair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(embedded);
    if (pair) {
      const hi = parseInt(pair[1]!, 16);
      const lo = parseInt(pair[2]!, 16);
      return isPrivateV4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
    }
  }
  // Link-local (fe80::/10 → fe80-febf) and unique-local (fc00::/7 → fc00-fdff).
  return /^(?:fe[89ab][0-9a-f]|f[cd][0-9a-f]{2}):/.test(addr);
}

function isPrivateV4(addr: string): boolean {
  const [a = 0, b = 0] = addr.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, incl. the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast and reserved
  );
}

const PRIVATE_NAME_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

/** A hostname (or address literal) that must never be fetched: the pure half of the guard. */
export function isPrivateHost(hostname: string): boolean {
  // A trailing dot is the same name to the resolver and a different string to a check.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(host)) return isPrivateIp(host);
  if (host === 'localhost' || PRIVATE_NAME_SUFFIXES.some((s) => host.endsWith(s))) return true;
  // A public name has a dot in it; a bare word is an intranet name.
  return !host.includes('.');
}

/** The addresses a name resolves to — injected so the guard is tested without the network. */
export type Resolver = (hostname: string) => Promise<string[]>;

const lookupAddresses: Resolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true })).map((a) => a.address);

const PUBLIC_ONLY = 'Only public posting URLs can be fetched.';

/** Layer 2: every address behind the name is public. An address literal has nothing to resolve. */
export async function resolvesToPublic(
  url: URL,
  resolve: Resolver = lookupAddresses,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host)) return { ok: true };
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, error: 'That host does not resolve — check the URL.' };
  }
  if (addresses.length === 0) return { ok: false, error: 'That host does not resolve — check the URL.' };
  return addresses.some(isPrivateIp) ? { ok: false, error: PUBLIC_ONLY } : { ok: true };
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** What a hop has to say about itself: the status, and where it points next. */
export interface Hop {
  status: number;
  location: string | null;
}

/** What the hop walk hands back: the answer and the URL that gave it, or why it stopped. */
export type HopResult<T> = { ok: true; response: T; url: string } | { ok: false; error: string };

/**
 * Layer 3: the request loop. `fetchOnce` makes ONE request with redirects
 * left unfollowed; this walks the chain, guarding every hop before it is
 * requested. The result carries the URL that answered, so the caller can
 * record where it landed.
 */
export async function fetchPublicHops<T extends Hop>(
  raw: string,
  fetchOnce: (url: string) => Promise<T>,
  resolve: Resolver = lookupAddresses,
): Promise<HopResult<T>> {
  const checked = checkPostingUrl(raw);
  if (!checked.ok) return checked;
  let url = checked.url;
  for (let hops = 0; ; hops++) {
    const pub = await resolvesToPublic(url, resolve);
    if (!pub.ok) return pub;
    const response = await fetchOnce(url.toString());
    if (!REDIRECT_STATUSES.has(response.status) || !response.location) {
      return { ok: true, response, url: url.toString() };
    }
    if (hops >= MAX_REDIRECTS) return { ok: false, error: 'That URL redirects too many times.' };
    let next: URL;
    try {
      next = new URL(response.location, url);
    } catch {
      return { ok: false, error: 'That URL redirects somewhere unreadable.' };
    }
    const again = checkPostingUrl(next.toString());
    if (!again.ok) return again;
    url = again.url;
  }
}

/** The guard said no — distinct from a network or HTTP failure, which pass through unchanged. */
class PublicUrlError extends Error {}

/** fetchWithRetry for a user-supplied URL: the three layers, then the response that answered. */
export async function fetchPublicUrl(raw: string, options: FetchOptions = {}): Promise<Response> {
  const got = await fetchPublicHops(raw, (url) =>
    fetchWithRetry(url, { ...options, init: { ...options.init, redirect: 'manual' } }).then(async (resp) => {
      const location = resp.headers.get('location');
      // A hop's body is never read; drained so the connection goes back to the pool.
      if (REDIRECT_STATUSES.has(resp.status)) await resp.body?.cancel().catch(() => undefined);
      return { status: resp.status, location, resp };
    }),
  );
  if (!got.ok) throw new PublicUrlError(got.error);
  return got.response.resp;
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
  if (url.username || url.password) {
    return { ok: false, error: 'A posting URL with a password in it is not fetched.' };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_POSTING_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) {
    return {
      ok: false,
      error: 'That site is never fetched here (ADR 0005) — paste the posting text instead.',
    };
  }
  if (isPrivateHost(host)) {
    return { ok: false, error: PUBLIC_ONLY };
  }
  return { ok: true, url };
}

export function postingTextFromHtml(html: string): PostingUrlResult {
  return postingText(stripHtml(html).trim());
}

function postingText(text: string): PostingUrlResult {
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

export async function fetchPostingText(raw: string, opts: { title?: string } = {}): Promise<PostingUrlResult> {
  const checked = checkPostingUrl(raw);
  if (!checked.ok) return checked;
  const ashby = parseAshbyUrl(checked.url);
  if (ashby) return fetchAshbyPosting(ashby, opts.title);
  try {
    const res = await fetchPublicUrl(checked.url.toString(), { timeoutMs: FETCH_TIMEOUT_MS });
    return postingTextFromHtml(await res.text());
  } catch (err) {
    if (err instanceof PublicUrlError) return { ok: false, error: err.message };
    if (err instanceof HttpError && (err.status === 403 || err.status === 429 || err.status === 503)) {
      return { ok: false, error: 'The page answered with a bot check — paste the posting text instead.' };
    }
    return {
      ok: false,
      error: `Could not fetch that URL (${err instanceof Error ? err.message : 'unknown error'}) — paste the text instead.`,
    };
  }
}

async function fetchAshbyPosting(ref: AshbyRef, title: string | undefined): Promise<PostingUrlResult> {
  try {
    const res = await fetchWithRetry(`${ASHBY_API}${encodeURIComponent(ref.org)}`, { timeoutMs: FETCH_TIMEOUT_MS });
    const parsed = AshbyPostingSchema.safeParse(await res.json());
    if (!parsed.success) {
      return { ok: false, error: 'The Ashby board answered with something other than its listings — paste the text instead.' };
    }
    const pick = pickAshbyJob(parsed.data.jobs, ref, title);
    return pick.ok ? ashbyPostingText(pick.job) : pick;
  } catch (err) {
    return {
      ok: false,
      error: `Could not read the Ashby board (${err instanceof Error ? err.message : 'unknown error'}) — paste the text instead.`,
    };
  }
}
