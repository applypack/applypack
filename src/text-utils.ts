/**
 * Pure text/parsing helpers shared across modules. Keep this file free of
 * side-effectful imports (no db, no config) so it's testable in isolation.
 */

import { createHash } from 'node:crypto';

/**
 * Stable 16-char hex id derived from any string. Used by fetchers to
 * synthesize an externalId when the upstream source does not expose one.
 */
export function hashShortId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

/**
 * Query parameters that identify a *campaign*, not a posting. Two links that
 * differ only here are the same job, so they must hash to the same id.
 * Literal names (plus the `utm_` family) — never a broad pattern, which would
 * eventually eat a functional parameter like Greenhouse's `gh_jid`.
 */
const TRACKING_PARAMS = new Set([
  'gh_src',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'trk',
  'trkCampaign',
  'ref',
  'source',
]);

/**
 * A URL reduced to what identifies the posting: no tracking parameters, no
 * fragment, lower-cased host, sorted query. Returns **null** — never `''` —
 * for junk, so callers cannot collapse unrelated rows onto one shared key.
 */
export function normalizeUrlKey(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const kept = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.has(k) && !k.toLowerCase().startsWith('utm_'))
    // Sorted so two orderings of the same parameters agree.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const query = kept.map(([k, v]) => `${k}=${v}`).join('&');
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.host.toLowerCase()}${path}${query ? `?${query}` : ''}`;
}

/**
 * Free text reduced to a comparable key. NFKC then letters/marks/digits in
 * **any** script — an ASCII-only strip would map every Cyrillic or CJK
 * company name to the empty string and collide them all. Null for junk.
 */
export function normalizeTextKey(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const tokens = input.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.join(' ');
}

/**
 * Stable externalId for a feed row that carries no id of its own: the
 * normalized URL if there is one, else title + company. Null when neither
 * yields anything — the caller must skip the row rather than hash `''`,
 * which would merge every junk row into one.
 */
export function feedItemKey(
  url: string | null | undefined,
  ...textParts: Array<string | null | undefined>
): string | null {
  const urlKey = normalizeUrlKey(url);
  if (urlKey !== null) return hashShortId(urlKey);
  const text = textParts
    .map((p) => normalizeTextKey(p))
    .filter((p): p is string => p !== null)
    .join('|');
  return text.length > 0 ? hashShortId(text) : null;
}

/**
 * Parses a textarea value into a list of trimmed tags. Accepts both newline
 * and comma separators. Empty entries are dropped.
 */
export function parseTagList(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Form fields that may arrive as undefined / single string / string[] —
 * normalise to a string[].
 */
export function toStringArray(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') return v.length > 0 ? [v] : [];
  return [];
}

/**
 * Mask a Telegram bot token (or any secret-ish string) for display:
 * "12345678***xyz9". Tokens shorter than 12 chars are fully redacted.
 */
export function maskToken(token: string): string {
  if (token.length <= 12) return '***';
  // Last 4 only — a Telegram token's prefix is the bot id, itself identifying.
  return `***${token.slice(-4)}`;
}

/**
 * Best-effort JSON extraction from text that may have leading/trailing
 * commentary. Finds the first '{' and last '}' and tries JSON.parse on the
 * substring. Returns null on any parse failure.
 */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Maps a classifier mode to the stage-1 decision. Trivial but explicit so
 * we can unit-test the toggle semantics in isolation from the API client.
 */
export function decideStageStrategy(
  mode: 'single' | 'two_stage',
): 'skip-stage1' | 'run-stage1' {
  return mode === 'two_stage' ? 'run-stage1' : 'skip-stage1';
}

/**
 * Whole days between `then` and `now`. Used by the stale-applications cron
 * to decide which APPLIED jobs deserve a follow-up reminder.
 */
export function daysSince(then: Date, now: Date = new Date()): number {
  const ms = now.getTime() - then.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Recognise an ATS company URL and return the (atsType, atsToken) pair.
 * Used by the discovery pipeline to harvest CompanyCandidate rows from
 * URLs found in HN comments / blog posts / etc.
 *
 * Returns null when the URL is not a known ATS pattern (so the caller
 * can simply skip it rather than guess).
 */
export type DiscoverableAtsType =
  | 'GREENHOUSE'
  | 'LEVER'
  | 'ASHBY'
  | 'WORKABLE'
  | 'SMARTRECRUITERS'
  | 'RECRUITEE'
  | 'BREEZY'
  | 'BAMBOOHR'
  | 'PINPOINT'
  | 'RIPPLING';

// Vendor marketing/support subdomains that look like board slugs in
// subdomain-style ATS URLs ({slug}.recruitee.com) but never are.
const GENERIC_SUBDOMAINS = new Set([
  'www',
  'careers',
  'api',
  'app',
  'docs',
  'support',
  'help',
  'blog',
  'status',
]);

export function extractAtsToken(
  url: string,
): { atsType: DiscoverableAtsType; atsToken: string } | null {
  if (!url || typeof url !== 'string') return null;
  // Greenhouse: boards.greenhouse.io/{token} OR
  //             boards.greenhouse.io/embed/job_board?for={token}
  let m =
    /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]{2,60})/i.exec(
      url,
    );
  if (m && m[1]) {
    return { atsType: 'GREENHOUSE', atsToken: m[1].toLowerCase() };
  }
  // Lever: jobs.lever.co/{slug}/...
  m = /https?:\/\/jobs\.lever\.co\/([\w-]{2,60})/i.exec(url);
  if (m && m[1]) {
    return { atsType: 'LEVER', atsToken: m[1].toLowerCase() };
  }
  // Ashby: jobs.ashbyhq.com/{org} OR api.ashbyhq.com/posting-api/job-board/{org}
  m =
    /https?:\/\/(?:jobs\.ashbyhq\.com|api\.ashbyhq\.com\/posting-api\/job-board)\/([\w-]{2,60})/i.exec(
      url,
    );
  if (m && m[1]) {
    return { atsType: 'ASHBY', atsToken: m[1].toLowerCase() };
  }
  // Workable: apply.workable.com/{slug}/  OR  apply.workable.com/{slug}/j/...
  m = /https?:\/\/apply\.workable\.com\/([\w-]{2,60})(?:\/|$|\?)/i.exec(url);
  if (m && m[1]) {
    return { atsType: 'WORKABLE', atsToken: m[1].toLowerCase() };
  }
  // SmartRecruiters: jobs.smartrecruiters.com/{Slug}  OR
  //                  careers.smartrecruiters.com/{Slug}  OR
  //                  api.smartrecruiters.com/v1/companies/{Slug}/...
  m =
    /https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([\w-]{2,60})/i.exec(url);
  if (m && m[1]) {
    // SmartRecruiters slugs are case-sensitive per their API — preserve case.
    return { atsType: 'SMARTRECRUITERS', atsToken: m[1] };
  }
  m =
    /https?:\/\/api\.smartrecruiters\.com\/v1\/companies\/([\w-]{2,60})/i.exec(
      url,
    );
  if (m && m[1]) {
    return { atsType: 'SMARTRECRUITERS', atsToken: m[1] };
  }
  // Recruitee: {slug}.recruitee.com (careers site or /api/offers/)
  m = /https?:\/\/([\w-]{2,60})\.recruitee\.com/i.exec(url);
  if (m && m[1] && !GENERIC_SUBDOMAINS.has(m[1].toLowerCase())) {
    return { atsType: 'RECRUITEE', atsToken: m[1].toLowerCase() };
  }
  // Breezy: {slug}.breezy.hr board or /p/{position} link
  m = /https?:\/\/([\w-]{2,60})\.breezy\.hr/i.exec(url);
  if (m && m[1] && !GENERIC_SUBDOMAINS.has(m[1].toLowerCase())) {
    return { atsType: 'BREEZY', atsToken: m[1].toLowerCase() };
  }
  // BambooHR: {slug}.bamboohr.com/careers or /careers/{id}
  m = /https?:\/\/([\w-]{2,60})\.bamboohr\.com\/careers/i.exec(url);
  if (m && m[1] && !GENERIC_SUBDOMAINS.has(m[1].toLowerCase())) {
    return { atsType: 'BAMBOOHR', atsToken: m[1].toLowerCase() };
  }
  // Pinpoint: {slug}.pinpointhq.com board or /postings/{uuid} link
  m = /https?:\/\/([\w-]{2,60})\.pinpointhq\.com/i.exec(url);
  if (m && m[1] && !GENERIC_SUBDOMAINS.has(m[1].toLowerCase())) {
    return { atsType: 'PINPOINT', atsToken: m[1].toLowerCase() };
  }
  // Rippling: ats.rippling.com/{slug}/jobs OR the board API URL
  m =
    /https?:\/\/(?:ats\.rippling\.com|api\.rippling\.com\/platform\/api\/ats\/v1\/board)\/([\w-]{2,60})/i.exec(
      url,
    );
  if (m && m[1]) {
    return { atsType: 'RIPPLING', atsToken: m[1].toLowerCase() };
  }
  return null;
}
