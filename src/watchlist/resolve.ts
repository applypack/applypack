import { AtsType } from '@prisma/client';
import { fetchWithRetry, HttpError } from '../http';
import { probeAts } from '../ats-probe';
import { getSettings, getSourceKeys } from '../settings';
import { aiCrawlerTokens, parseAiEngineConfig, type AiProviderId } from '../ai-engine';
import { config } from '../config';
import { extractAtsToken } from '../text-utils';
import { checkPostingUrl } from '../jobs/posting-url';
import { bindingTokens, robotsAllows } from '../robots';
import { looksLikeFeed } from '../fetchers/feed';
import { boardHints, declaredJobFeeds, looksLikeChallenge, wellKnownFeeds } from './scan';
import { nameFromUrl, type CompanyInput } from './parse-input';
import { boardMissReason } from './verdict';

/**
 * One pasted URL → what we can actually watch (TASKS §17 stage A, ADR 0036).
 *
 * The ladder, in the order the fixture proved useful (docs/company-watchlist.md):
 *
 * 1. **The URL is already a board.** `jobs.lever.co/acme` needs no page fetch.
 * 2. **The URL redirects to one.** deno.com/jobs lands on jobs.ashbyhq.com.
 * 3. **The page links to one.** Vercel, Netlify, Supabase, Linear and Sentry
 *    all put the board URL in their markup.
 * 4. **A declared feed whose own path names jobs**, then three well-known
 *    job-shaped paths.
 * 5. **Nothing machine-readable** — `watchOnly`, honestly labelled, which is
 *    where stage B's sitemap + JSON-LD rung will pick it up.
 * 6. **Refused**, with the reason on screen: an ADR 0005 host, a private
 *    address, a robots.txt that says no, an HTTP error, a bot check.
 *
 * Two invariants:
 *
 * - **A board URL is not a board.** Every `ats` verdict is confirmed by
 *   `probeAts` first. `jobs.ashbyhq.com/Deno` answers 200 while Ashby's
 *   public posting API 404s for that org — a URL match alone would have added
 *   a source that can never return a posting.
 * - **The budget is spent on the user's host, at add time only.** At most
 *   `MAX_HOST_REQUESTS` requests go to the site being resolved, and the
 *   ladder stops at the first rung that answers.
 */

/** Requests made against the pasted site. robots.txt is the first of them. */
export const MAX_HOST_REQUESTS = 5;

/** How many board links off one page are worth confirming with the vendor. */
const MAX_BOARD_PROBES = 3;

const FETCH_TIMEOUT_MS = 12_000;

export type Resolution =
  | { kind: 'ats'; atsType: AtsType; atsToken: string; jobs: number; via: string }
  | { kind: 'feed'; url: string; items: number; via: string }
  | { kind: 'watchOnly'; reason: string }
  | { kind: 'refused'; reason: string };

export interface ResolvedCompany {
  input: CompanyInput;
  /** The name to create the row with: the user's, else the page's, else the host's. */
  name: string;
  /** Where the row's `careerUrl` points — the landed URL, so a redirect is kept. */
  careerUrl: string;
  resolution: Resolution;
  requests: number;
}

/** One HTTP answer, reduced to what the ladder reads. A network failure is a 0. */
export interface PageAnswer {
  status: number;
  /** The URL that actually answered, after redirects. */
  url: string;
  body: string;
}

/** The I/O the ladder needs, injected so the ladder itself is testable. */
export interface ResolveIo {
  get(url: string): Promise<PageAnswer>;
  probe(atsType: AtsType, atsToken: string): Promise<{ ok: boolean; jobsCount?: number; error?: string }>;
}

export interface ResolveOptions {
  /**
   * The vendor crawler tokens of the AI backends this install runs — the
   * robots.txt groups that bind us besides our own (ADR 0036). Read once per
   * run by the caller (`installAiTokens`), so every URL of one paste is
   * judged against the same engine list. Omitted falls back to every backend
   * this project supports — asking for less than we may, never more.
   */
  aiTokens?: readonly string[];
}

export async function resolveCompanyUrl(
  input: CompanyInput,
  io: ResolveIo,
  opts: ResolveOptions = {},
): Promise<ResolvedCompany> {
  const tokens = bindingTokens(opts.aiTokens);
  const base = { input, name: input.name ?? nameFromUrl(input.url), careerUrl: input.url };

  const checked = checkPostingUrl(input.url);
  if (!checked.ok) return { ...base, resolution: { kind: 'refused', reason: checked.error }, requests: 0 };
  const target = checked.url;

  // Rung 1: the pasted URL is already a board. No page fetch, no robots read —
  // we are about to call the vendor's own documented API, not crawl the site.
  const direct = extractAtsToken(target.toString());
  if (direct) {
    const confirmed = await confirmBoard(direct, target.toString(), io);
    if (confirmed) return { ...base, resolution: confirmed, requests: 0 };
    return { ...base, resolution: { kind: 'watchOnly', reason: boardMissReason(direct) }, requests: 0 };
  }

  let requests = 0;
  const robotsAnswer = await io.get(`${target.origin}/robots.txt`);
  requests++;
  const robots = robotsAllows(robotsAnswer.status, robotsAnswer.body, target.pathname, tokens);
  if (!robots.allowed) return { ...base, resolution: { kind: 'refused', reason: robots.reason }, requests };

  const page = await io.get(target.toString());
  requests++;
  if (page.status === 0) {
    return { ...base, resolution: { kind: 'refused', reason: 'That site did not answer.' }, requests };
  }
  if (page.status < 200 || page.status >= 300) {
    return {
      ...base,
      resolution: { kind: 'refused', reason: `That URL answered HTTP ${page.status} — check the link.` },
      requests,
    };
  }
  // A public host can redirect into the private range or onto a blocked one.
  const landed = checkPostingUrl(page.url);
  if (!landed.ok) return { ...base, resolution: { kind: 'refused', reason: landed.error }, requests };
  const named = { ...base, name: input.name ?? nameFromUrl(page.url), careerUrl: page.url };

  // Rung 2: the redirect landed on a board. A board URL whose public API does
  // not serve it is worth saying out loud rather than folding into "nothing
  // found" — measured on deno.com/jobs, which lands on a live Ashby board
  // whose posting API is switched off.
  let boardMiss: string | null = null;
  const redirected = extractAtsToken(page.url);
  if (redirected) {
    const confirmed = await confirmBoard(redirected, page.url, io);
    if (confirmed) return { ...named, resolution: confirmed, requests };
    boardMiss = boardMissReason(redirected);
  }

  // Rung 3: the page links to one. Confirmed with the vendor before it counts.
  for (const hint of boardHints(page.body).slice(0, MAX_BOARD_PROBES)) {
    const confirmed = await confirmBoard(hint, hint.url, io);
    if (confirmed) return { ...named, resolution: confirmed, requests };
  }

  // Rung 4: a feed. Declared first, then the job-shaped well-known paths, and
  // only ever a feed that carries entries — a valid empty one is not a source.
  for (const url of [...declaredJobFeeds(page.body, page.url), ...wellKnownFeeds(page.url)]) {
    if (requests >= MAX_HOST_REQUESTS) break;
    // A declared href is content from the page we just fetched, so it is
    // untrusted input and goes through the same guard the pasted URL did —
    // `<link rel="alternate" href="http://169.254.169.254/…">` is a valid tag.
    const checkedFeed = checkPostingUrl(url);
    if (!checkedFeed.ok) continue;
    if (!robotsAllows(robotsAnswer.status, robotsAnswer.body, checkedFeed.url.pathname, tokens).allowed) continue;
    const answer = await io.get(url);
    requests++;
    // And again on whatever answered, for the same reason as the page above.
    if (answer.status !== 200 || !checkPostingUrl(answer.url).ok || !looksLikeFeed(answer.body)) continue;
    const items = countEntries(answer.body);
    if (items === 0) continue;
    return { ...named, resolution: { kind: 'feed', url, items, via: url }, requests };
  }

  // Rung 5. A bot check is reported as itself, because the answer to it is
  // different: nothing here will ever work, not even stage B's sitemap rung.
  if (looksLikeChallenge(page.body)) {
    return {
      ...named,
      resolution: { kind: 'refused', reason: 'That page answered with a bot check — find the company on a supported ATS instead.' },
      requests,
    };
  }
  return {
    ...named,
    resolution: {
      kind: 'watchOnly',
      reason: boardMiss ?? 'No job board and no job feed on that page. Paste the board URL if you know it.',
    },
    requests,
  };
}


/** `<item>` / `<entry>` count — the emptiness test, not a parse. */
export function countEntries(xml: string): number {
  return (xml.match(/<item[\s>]|<entry[\s>]/gi) ?? []).length;
}

/** A URL match becomes an `ats` verdict only once the vendor confirms the token. */
async function confirmBoard(
  hit: { atsType: string; atsToken: string },
  via: string,
  io: ResolveIo,
): Promise<Extract<Resolution, { kind: 'ats' }> | null> {
  const atsType = hit.atsType as AtsType;
  const probe = await io.probe(atsType, hit.atsToken);
  if (!probe.ok) return null;
  return { kind: 'ats', atsType, atsToken: hit.atsToken, jobs: probe.jobsCount ?? 0, via };
}

/**
 * The crawler tokens this install is bound by, from the engines the user
 * enabled — the stored chain, plus the .env provider that runs when the
 * chain is empty. Everything the install *might* call counts, not only what
 * is usable this minute: an engine that is skipped today because its CLI is
 * not logged in will read these descriptions tomorrow.
 */
export async function installAiTokens(): Promise<string[]> {
  const stored = parseAiEngineConfig((await getSettings()).aiEngine).order;
  const providers: AiProviderId[] = [...new Set([...stored, config.AI_PROVIDER as AiProviderId])];
  return aiCrawlerTokens(providers);
}

/**
 * The real I/O: every request goes through the project's guards and UA.
 *
 * The keyed sources' credentials are read once per run, not once per probe:
 * a paste of fifty URLs probes up to three boards each, and that was fifty
 * to a hundred and fifty round trips to Postgres for one unchanging row.
 */
export async function liveResolveIo(): Promise<ResolveIo> {
  const keys = await getSourceKeys();
  return {
    async get(url) {
      try {
        const resp = await fetchWithRetry(url, { timeoutMs: FETCH_TIMEOUT_MS });
        return { status: resp.status, url: resp.url || url, body: await resp.text() };
      } catch (err) {
        // fetchWithRetry throws on every non-2xx; the status is the answer.
        if (err instanceof HttpError) return { status: err.status, url, body: err.body ?? '' };
        return { status: 0, url, body: '' };
      }
    },
    async probe(atsType, atsToken) {
      return probeAts(atsType, atsToken, { keys });
    },
  };
}
