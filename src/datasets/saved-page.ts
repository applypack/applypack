/*
 * A posting the user saved as a web page ("Save page as…"), read with no
 * model (ADR 0062, saved postings): the text, the page's own address, and the
 * `JobPosting` block many job pages carry for search engines. The page is
 * never rendered — its markup only ever becomes text — and nothing here makes
 * a request: an address is kept as the job's link, not followed.
 * Pure — tested in saved-page.test.ts.
 */

import { cleanEmployer } from '../employer';
import { decodeHtmlEntities, stripHtml } from '../http';
import type { WorkplaceCode } from '../location';
import { clipText, storableText } from '../text-utils';
import { safeHref } from '../web/format';
import { readDate } from './map';

/** What the page's `JobPosting` block says, each fact null when it does not. */
export interface PageFacts {
  title: string | null;
  company: string | null;
  location: string | null;
  workplace: WorkplaceCode | null;
  postedAt: Date | null;
}

export interface SavedPage {
  /** The posting as text: the block's description when it has one long enough, else the page's main text. */
  text: string;
  /** Where the page was saved from, http(s) only; null when the page does not say. */
  address: string | null;
  /**
   * Whether the address names this posting alone: the posting block's own
   * `url` or the browser's "saved from" note. A canonical link or `og:url`
   * may be a whole careers page that many postings share.
   */
  addressIsOwn: boolean;
  /** Null when the page carries no `JobPosting` block. */
  facts: PageFacts | null;
  /** The page's own `<title>`, for the preview; never a job's title by itself. */
  pageTitle: string | null;
}

/** As `jobs/manual-job.ts:MAX_POSTING_CHARS`: the most a posting may run to. */
export const MAX_POSTING_TEXT_CHARS = 60_000;
/** A description shorter than this is a teaser, and the page's own text says more. */
const MIN_BLOCK_TEXT_CHARS = 200;
const MAX_FIELD_CHARS = 200;
const MAX_LINK_CHARS = 2_000;
/** How many structured-data blocks are read, and how long one may be: a page is not a database. */
const MAX_BLOCKS = 8;
const MAX_BLOCK_CHARS = 200_000;
/** The tags that name the page's address sit in its head; a 2 MB body is not searched for them. */
const HEAD_CHARS = 300_000;
/** How deep a block's nesting is walked to find the posting (an array, a `@graph`, a page wrapping it). */
const MAX_DEPTH = 4;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A short fact as the page wrote it: entities decoded, markup and control characters gone, one line, capped. */
function field(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  // Cleaned after the markup is gone: an entity such as `&#7;` only becomes a control character there.
  const text = clipText(storableText(oneLine(stripHtml(String(value)))), MAX_FIELD_CHARS).trim();
  return text.length > 0 ? text : null;
}

function link(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_LINK_CHARS) return null;
  return safeHref(decodeHtmlEntities(value.trim()));
}

/** One attribute of one tag, its entities decoded; quoted or bare. */
function attribute(tag: string, name: string): string | null {
  const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  const value = found ? (found[1] ?? found[2] ?? found[3] ?? '') : null;
  return value === null ? null : decodeHtmlEntities(value);
}

/** Every opening tag of one name in the head, as text. `[^<>]` stops at the next tag, so `<link<link<link…` stays linear. */
function tags(head: string, name: string): string[] {
  return head.match(new RegExp(`<${name}\\b[^<>]*>`, 'gi')) ?? [];
}

/**
 * The page's address, from what the page says about itself: the posting
 * block's `url` and the browser's "saved from url=" note first — they name
 * this posting — then its canonical link and its `og:url`, which a careers
 * page that embeds a board shares across every posting on it.
 */
function pageAddress(head: string, blockUrl: unknown): { address: string | null; own: boolean } {
  const savedFrom = /<!--\s*saved from url=\(\d{1,4}\)(\S{1,2000}?)\s*-->/i.exec(head)?.[1];
  for (const candidate of [blockUrl, savedFrom]) {
    const href = link(candidate);
    if (href !== null) return { address: href, own: true };
  }
  const canonical = tags(head, 'link').find((tag) => /(^|\s)canonical(\s|$)/i.test(attribute(tag, 'rel') ?? ''));
  const og = tags(head, 'meta').find((tag) => (attribute(tag, 'property') ?? attribute(tag, 'name'))?.toLowerCase() === 'og:url');
  for (const candidate of [canonical && attribute(canonical, 'href'), og && attribute(og, 'content')]) {
    const href = link(candidate);
    if (href !== null) return { address: href, own: false };
  }
  return { address: null, own: false };
}

/** The contents of every `application/ld+json` script, at most `MAX_BLOCKS` of them, found by index, not by a pattern that could backtrack. */
function structuredBlocks(html: string): string[] {
  const blocks: string[] = [];
  const lower = html.toLowerCase();
  let at = 0;
  while (blocks.length < MAX_BLOCKS) {
    const open = lower.indexOf('<script', at);
    if (open === -1) break;
    const tagEnd = lower.indexOf('>', open);
    if (tagEnd === -1) break;
    const close = lower.indexOf('</script', tagEnd);
    if (close === -1) break;
    if (/type\s*=\s*["']?application\/ld\+json/.test(lower.slice(open, tagEnd)) && close - tagEnd <= MAX_BLOCK_CHARS) {
      blocks.push(html.slice(tagEnd + 1, close));
    }
    at = close + 8;
  }
  return blocks;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isPosting(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

/** The first `JobPosting` in a parsed block: the block itself, an item of a list, of a `@graph`, or one level inside a page. */
function findPosting(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 50)) {
      const found = findPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(node)) return null;
  if (isPosting(node)) return node;
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item']) {
    const found = findPosting(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

/** A name that may come as text or as `{ name }`. */
const named = (value: unknown): string | null => field(isObject(value) ? value.name : value);

/** One place of `jobLocation`: its address as text, or its parts joined. */
function placeOf(value: unknown): string | null {
  const address = isObject(value) ? value.address : value;
  if (!isObject(address)) return field(address);
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry].map(named).filter((p): p is string => p !== null);
  return parts.length > 0 ? [...new Set(parts)].join(', ') : null;
}

function readFacts(posting: Record<string, unknown>, now: Date): PageFacts {
  const places = asList(posting.jobLocation).slice(0, 5).map(placeOf).filter((p): p is string => p !== null);
  const remote = asList(posting.jobLocationType).some((t) => typeof t === 'string' && t.toUpperCase() === 'TELECOMMUTE');
  const regions = asList(posting.applicantLocationRequirements).slice(0, 5).map(named).filter((p): p is string => p !== null);
  const location = places.length > 0 ? places.join('; ') : remote ? ['Remote', ...regions].join(', ') : null;
  const company = named(posting.hiringOrganization);
  return {
    title: field(posting.title) ?? field(posting.name),
    company: company === null ? null : cleanEmployer(company),
    location: location === null ? null : clipText(location, MAX_FIELD_CHARS),
    workplace: remote ? 'REMOTE' : null,
    postedAt: readDate(posting.datePosted, now),
  };
}

/** The page's main text: its `<main>`, else its `<article>`, else the whole page — navigation and footers are not the posting. */
function mainText(html: string): string {
  const lower = html.toLowerCase();
  for (const name of ['main', 'article']) {
    const open = lower.indexOf(`<${name}`);
    const close = open === -1 ? -1 : lower.lastIndexOf(`</${name}`);
    if (close > open) {
      const text = stripHtml(html.slice(open, close));
      if (text.length >= MIN_BLOCK_TEXT_CHARS) return text;
    }
  }
  return stripHtml(html);
}

export function readSavedPage(html: string, now: Date = new Date()): SavedPage {
  const head = html.slice(0, HEAD_CHARS);
  let posting: Record<string, unknown> | null = null;
  for (const block of structuredBlocks(html)) {
    try {
      posting = findPosting(JSON.parse(block));
    } catch {
      // A block that is not JSON is the page's mistake, and the page's own text still reads.
    }
    if (posting) break;
  }
  const blockText = posting && typeof posting.description === 'string' ? stripHtml(storableText(posting.description)) : '';
  const text = blockText.length >= MIN_BLOCK_TEXT_CHARS ? blockText : mainText(html);
  const titleTag = /<title\b[^<>]*>([^<]{1,1000})<\/title\s*>/i.exec(head)?.[1];
  const { address, own } = pageAddress(head, posting?.url);
  return {
    text: clipText(storableText(text).trim(), MAX_POSTING_TEXT_CHARS).trim(),
    address,
    addressIsOwn: own,
    facts: posting ? readFacts(posting, now) : null,
    pageTitle: titleTag === undefined ? null : field(titleTag),
  };
}
