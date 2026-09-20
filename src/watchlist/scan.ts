/**
 * What a careers page tells a machine (TASKS §17 stage A). Pure — the
 * resolver fetches, this reads.
 *
 * Everything here is bounded by one rule the fixture bought: **only data a
 * site publishes on purpose counts.** An `<a href>` to a board API, a
 * `<link rel="alternate">` whose own path names jobs. Not a class name, not a
 * heading, not a guess at what a div means.
 */
import { stripHtml } from '../http';
import { extractAtsToken, type DiscoverableAtsType } from '../text-utils';

/** A board link found on the page. */
export interface BoardHint {
  atsType: DiscoverableAtsType;
  atsToken: string;
  /** The URL it was read from, for the preview's "found at" line. */
  url: string;
}

/**
 * Every ATS URL in the markup, best-known first, each once. The whole
 * document is scanned — script blobs and JSON islands included — because a
 * modern careers page links its board from a data attribute or a hydration
 * payload as often as from an anchor.
 */
export function boardHints(html: string): BoardHint[] {
  const out: BoardHint[] = [];
  const seen = new Set<string>();
  for (const raw of urlsIn(html)) {
    const hit = extractAtsToken(raw);
    if (!hit) continue;
    const key = `${hit.atsType}:${hit.atsToken}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...hit, url: raw });
  }
  return out;
}

/** Absolute http(s) URLs in a document, unescaped from JSON's `\/` on the way. */
export function urlsIn(html: string): string[] {
  const text = html.replace(/\\\//g, '/');
  return [...text.matchAll(/https?:\/\/[^\s"'<>)\\]+/gi)].map((m) => m[0]);
}

/**
 * A path that says it lists jobs. This is the whole defence against the two
 * false positives the fixture found: PostHog's `/feed` is a 253-item blog and
 * Netlify's declared alternate is `/feed.xml`, also a blog. Neither path
 * names jobs, so neither is ever fetched.
 */
export function isJobFeedPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return (
    /(?:^|\/)(?:jobs?|careers?|vacancies|vacatures|stellen|openings|positions)[^/]*\.(?:rss|xml|atom)$/.test(path) ||
    /(?:^|\/)(?:jobs?|careers?|vacancies|vacatures|stellen|openings|positions)\/(?:feed|rss|atom)(?:\.xml)?\/?$/.test(path)
  );
}

/**
 * Declared feeds whose own path names jobs, absolute against the page's URL.
 * A `<link rel="alternate" type="application/rss+xml">` is the only feed
 * declaration a site makes deliberately.
 */
export function declaredJobFeeds(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/type=["']application\/(?:rss|atom)\+xml["']/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (href === undefined) continue;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!isJobFeedPath(url.pathname)) continue;
    if (!out.includes(url.toString())) out.push(url.toString());
  }
  return out;
}

/**
 * The paths worth trying when nothing was declared, in order. Kept short and
 * job-shaped on purpose: `/feed` and `/rss.xml` are never tried, because on
 * WordPress every `/<anything>/feed` answers a well-formed feed and on most
 * sites `/feed` is the blog.
 */
const WELL_KNOWN_FEED_PATHS = ['/jobs.rss', '/jobs/feed', '/careers/feed'] as const;

export function wellKnownFeeds(pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin;
  return WELL_KNOWN_FEED_PATHS.map((p) => `${origin}${p}`);
}

/**
 * Bot-check phrasing only, read from the page's TEXT rather than its markup.
 * The one detector in the project: `jobs/posting-url.ts` reads a pasted
 * posting through `looksLikeChallengeText`.
 *
 * Two false positives, both measured on 2026-09-04, set these rules:
 *
 * - The bare word "cloudflare" refused cloudflare.com's own careers page as a
 *   bot check. A careers page belongs to a company that may be named after
 *   the vendor protecting it, so a vendor's name is never evidence. The
 *   posting reader kept the bare word until ADR 0036's note was acted on; it
 *   now reads these phrases too, so a posting that lists "Cloudflare Workers"
 *   on its stack line is a posting.
 * - The bare word "captcha" matched `.grecaptcha-badge` in a `<style>` block
 *   (jobs.ashbyhq.com) and `<!-- ReCaptcha -->` in a `<head>` (storyblok.com).
 *   A site that puts a captcha on its contact form has not challenged us.
 *
 * Hence: strip the markup first, then look only for what an interstitial
 * actually says to a reader.
 */
const CHALLENGE =
  /just a moment|checking your browser|verify you are human|are you a (?:robot|human)|enable javascript and cookies|attention required|(?:solve|complete) the captcha|captcha challenge|security check to access|ddos protection by/i;

/** The window a challenge page fits in; a real posting is longer than its lede. */
const CHALLENGE_WINDOW = 2_000;

export function looksLikeChallenge(html: string): boolean {
  return looksLikeChallengeText(stripHtml(html));
}

/** The same question asked of text that has already been stripped (gotcha 12). */
export function looksLikeChallengeText(text: string): boolean {
  return CHALLENGE.test(text.slice(0, CHALLENGE_WINDOW));
}
