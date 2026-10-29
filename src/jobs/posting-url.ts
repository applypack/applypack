import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { fetchWithRetry, HttpError, stripHtml, type FetchOptions } from '../http';
import { looksLikeChallengeText } from '../watchlist/scan';
import { readSavedPage } from '../datasets/saved-page';
import { MIN_DESCRIPTION_CHARS } from './manual-job';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';
import { isBlockedPostingHost } from './blocked-hosts';

/*
 * Fetch one user-provided posting URL and turn the page into plain text for
 * the manual-job flow (/letter). This is a single page GET at the user's
 * explicit request — the same class as the liveness ladder's rung 2
 * (ADR 0016), not a crawler. ADR 0005 hosts are refused outright, and a
 * page that answers with a bot check fails honestly instead of being worked
 * around. The guards are pure and tested; only fetchPostingText does I/O.
 *
 * Every refusal is a sentence a page or a flash shows as it is, so each comes
 * from the catalog in the reader's language (ADR 0061).
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_TEXT_CHARS = 30_000;

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
    return job ? { ok: true, job } : { ok: false, error: t('posting.ashby.gone') };
  }
  const wanted = title?.trim().toLowerCase();
  const byTitle = wanted ? jobs.filter((j) => j.title.trim().toLowerCase() === wanted) : [];
  const [only] = byTitle;
  if (byTitle.length === 1 && only) return { ok: true, job: only };
  return {
    ok: false,
    error:
      byTitle.length > 1
        ? t('posting.ashby.several', { n: byTitle.length, title: title ?? '' })
        : t('posting.ashby.index', { n: jobs.length }),
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
  const h = hextets(addr);
  const v4 = (hi: number, lo: number): string => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const zero = (from: number, to: number): boolean => h.slice(from, to).every((x) => x === 0);
  // IPv4 inside IPv6, in every form a host may route: compatible (::a.b.c.d,
  // which takes in :: and ::1), mapped (::ffff:a.b.c.d, which the URL parser
  // writes as ::ffff:a9fe:a9fe), translated (::ffff:0:a.b.c.d, RFC 2765),
  // NAT64's well-known prefix (64:ff9b::/96) and 6to4 (2002:aabb:ccdd::/48
  // carries a.b.c.d after its prefix).
  const embedsV4 =
    zero(0, 6) ||
    (zero(0, 5) && h[5] === 0xffff) ||
    (zero(0, 4) && h[4] === 0xffff && h[5] === 0) ||
    (h[0] === 0x64 && h[1] === 0xff9b && zero(2, 6));
  if (embedsV4) return isPrivateV4(v4(h[6]!, h[7]!));
  if (h[0] === 0x2002) return isPrivateV4(v4(h[1]!, h[2]!));
  return (
    (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) || // NAT64 for local use (64:ff9b:1::/48)
    (h[0] === 0x2001 && h[1] === 0) || // Teredo: a tunnel to whatever its client is, never a posting
    (h[0] === 0x2001 && h[1] === 0xdb8) || // documentation
    (h[0] === 0x100 && zero(1, 4)) || // discard
    (h[0]! & 0xffc0) === 0xfe80 || // link-local
    (h[0]! & 0xffc0) === 0xfec0 || // site-local, deprecated and still routed by some
    (h[0]! & 0xfe00) === 0xfc00 || // unique-local
    h[0]! >= 0xff00 // multicast
  );
}

/** The eight 16-bit groups of a valid IPv6 address, `::` and a trailing dotted quad written out. */
function hextets(addr: string): number[] {
  const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr);
  const text = quad
    ? addr.slice(0, quad.index) + `${((+quad[1]! << 8) | +quad[2]!).toString(16)}:${((+quad[3]! << 8) | +quad[4]!).toString(16)}`
    : addr;
  const [head = '', tail] = text.split('::');
  const groups = (part: string): number[] => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
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
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (isIP(host)) return isPrivateIp(host);
  if (host === 'localhost' || PRIVATE_NAME_SUFFIXES.some((s) => host.endsWith(s))) return true;
  // A public name has a dot in it; a bare word is an intranet name.
  return !host.includes('.');
}

/** The addresses a name resolves to — injected so the guard is tested without the network. */
export type Resolver = (hostname: string) => Promise<string[]>;

const lookupAddresses: Resolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true })).map((a) => a.address);

/** The guard's refusal of a private address, as a catalog key: worded when it is returned, in the reader's language. */
const PUBLIC_ONLY = 'posting.publicOnly' satisfies MessageKey;

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
    return { ok: false, error: t('posting.noHost') };
  }
  if (addresses.length === 0) return { ok: false, error: t('posting.noHost') };
  return addresses.some(isPrivateIp) ? { ok: false, error: t(PUBLIC_ONLY) } : { ok: true };
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
    if (hops >= MAX_REDIRECTS) return { ok: false, error: t('posting.tooManyRedirects') };
    let next: URL;
    try {
      next = new URL(response.location, url);
    } catch {
      return { ok: false, error: t('posting.badRedirect') };
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
    return { ok: false, error: t('posting.notUrl') };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: t('posting.httpOnly') };
  }
  if (url.username || url.password) {
    return { ok: false, error: t('posting.hasPassword') };
  }
  const host = url.hostname.toLowerCase();
  if (isBlockedPostingHost(host)) {
    return { ok: false, error: t('posting.blockedSite') };
  }
  if (isPrivateHost(host)) {
    return { ok: false, error: t(PUBLIC_ONLY) };
  }
  return { ok: true, url };
}

/**
 * The posting, not the page around it: read as a saved posting is (its
 * JobPosting block, else its `<main>` or `<article>` without the menus and the
 * application form). The page read whole kept the site's navigation: Vercel's
 * own listing came back as 17 137 characters, the job 4 212 of them. A block's
 * description names neither the role nor the employer, and the letter reads
 * both off this text, so they go in front when the text lacks them.
 */
export function postingTextFromHtml(html: string): PostingUrlResult {
  const page = readSavedPage(html);
  const named = [page.facts?.title, page.facts?.company].filter((fact): fact is string => !!fact && !page.text.includes(fact));
  return postingText([...named, page.text].join('\n\n').trim());
}

function postingText(text: string): PostingUrlResult {
  if (looksLikeChallengeText(text)) {
    return { ok: false, error: t('posting.botCheck') };
  }
  if (text.length < MIN_DESCRIPTION_CHARS) {
    return { ok: false, error: t('posting.unreadable') };
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
      return { ok: false, error: t('posting.botCheck') };
    }
    return { ok: false, error: t('posting.fetchFailed', { reason: err instanceof Error ? err.message : t('posting.unknownError') }) };
  }
}

async function fetchAshbyPosting(ref: AshbyRef, title: string | undefined): Promise<PostingUrlResult> {
  try {
    const res = await fetchWithRetry(`${ASHBY_API}${encodeURIComponent(ref.org)}`, { timeoutMs: FETCH_TIMEOUT_MS });
    const parsed = AshbyPostingSchema.safeParse(await res.json());
    if (!parsed.success) {
      return { ok: false, error: t('posting.ashby.badAnswer') };
    }
    const pick = pickAshbyJob(parsed.data.jobs, ref, title);
    return pick.ok ? ashbyPostingText(pick.job) : pick;
  } catch (err) {
    return { ok: false, error: t('posting.ashby.failed', { reason: err instanceof Error ? err.message : t('posting.unknownError') }) };
  }
}
