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
import { clipText, normalizeUrlKey, storableText } from '../text-utils';
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
   * may be a whole careers page that many postings share, and a page that
   * lists several postings has no address that names one of them.
   */
  addressIsOwn: boolean;
  /** Null when the page carries no `JobPosting` block, or several and none that is the page's own. */
  facts: PageFacts | null;
  /** The page's own `<title>`, for the preview; never a job's title by itself. */
  pageTitle: string | null;
  /**
   * What versions up to 2.55.11 took a saved page's job id from: the first
   * block's `url`, else the browser's note, else the text. Jobs stored then
   * are found by it (posting-file.ts:identifyPosting).
   */
  earlierKey: string;
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
/** How many postings of a page are told apart: a page with more is a list whatever else it is. */
const MAX_POSTINGS = 20;

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

/** What the page's head says of where it came from, each null when it does not. */
interface HeadAddresses {
  /** The browser's "saved from url=" note. */
  savedFrom: string | null;
  canonical: string | null;
  og: string | null;
}

/** `noted`: where the browser says the page came from when it says so outside the markup — the head of a single-file save. */
function headAddresses(head: string, noted: string | null): HeadAddresses {
  const savedFrom = noted ?? /<!--\s*saved from url=\(\d{1,4}\)(\S{1,2000}?)\s*-->/i.exec(head)?.[1];
  const canonical = tags(head, 'link').find((tag) => /(^|\s)canonical(\s|$)/i.test(attribute(tag, 'rel') ?? ''));
  const og = tags(head, 'meta').find((tag) => (attribute(tag, 'property') ?? attribute(tag, 'name'))?.toLowerCase() === 'og:url');
  return { savedFrom: link(savedFrom), canonical: link(canonical && attribute(canonical, 'href')), og: link(og && attribute(og, 'content')) };
}

/**
 * The page's address, from what the page says about itself: the posting
 * block's `url` and the browser's "saved from url=" note first — they name
 * this posting — then its canonical link and its `og:url`, which a careers
 * page that embeds a board shares across every posting on it.
 */
function pageAddress(from: HeadAddresses, blockUrl: unknown): { address: string | null; own: boolean } {
  const own = link(blockUrl) ?? from.savedFrom;
  return own !== null ? { address: own, own: true } : { address: from.canonical ?? from.og, own: false };
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
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

/**
 * A block as JSON, or null. Blocks written by hand often break a string
 * across lines, which JSON forbids: the page then read as one with no block
 * at all, and a model was asked for a title the page states. Such a block is
 * read again with the line breaks inside its strings written as JSON writes
 * them; nothing else about it is guessed.
 */
function parseBlock(block: string): unknown {
  try {
    return JSON.parse(block);
  } catch {
    let mended = '';
    let inString = false;
    for (let i = 0; i < block.length; i++) {
      const ch = block[i]!;
      if (inString && ch === '\\') {
        // An escape is two characters, whatever the second is.
        mended += ch + (block[i + 1] ?? '');
        i++;
      } else if (ch === '"') {
        inString = !inString;
        mended += ch;
      } else if (inString && ch === '\n') mended += '\\n';
      else if (inString && ch === '\t') mended += '\\t';
      // The CR of a CRLF goes with its LF.
      else if (!(inString && ch === '\r')) mended += ch;
    }
    try {
      return JSON.parse(mended);
    } catch {
      // A block that is not JSON is the page's mistake, and the page's own text still reads.
      return null;
    }
  }
}

/** `JobPosting`, however the block spells the type: bare, as an IRI (`https://schema.org/JobPosting`) or prefixed (`schema:JobPosting`). */
const POSTING_TYPE_RE = /(?:^|[/#:])JobPosting$/;

function isPosting(node: Record<string, unknown>): boolean {
  return asList(node['@type']).some((type) => typeof type === 'string' && POSTING_TYPE_RE.test(type));
}

/** Every `JobPosting` in a parsed block, in the block's order: the block itself, the items of a list, of a `@graph`, or one level inside a page. */
function collectPostings(node: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > MAX_DEPTH || out.length >= MAX_POSTINGS) return;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 50)) collectPostings(item, out, depth + 1);
  } else if (isObject(node)) {
    if (isPosting(node)) out.push(node);
    else for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item']) collectPostings(node[key], out, depth + 1);
  }
}

/** A name that may come as text, as `{ name }`, or as a list of either: the first that says one. */
function named(value: unknown): string | null {
  for (const one of asList(value).slice(0, 5)) {
    const name = field(isObject(one) ? one.name : one);
    if (name !== null) return name;
  }
  return null;
}

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

/**
 * The posting this page is about, of the ones its blocks carry. One posting,
 * or the same one written twice, is it. Of several — the page's own and its
 * "similar jobs", or a page of search results — it is the one whose `url` is
 * the page's own address, as the browser's note, the canonical link or
 * `og:url` give it. With none named so, the page is a list and code reads no
 * posting off it: the first on a list is somebody else's job.
 */
function ownPosting(postings: readonly Record<string, unknown>[], pageAddresses: readonly (string | null)[]): Record<string, unknown> | null {
  const urlKey = (posting: Record<string, unknown>): string | null => normalizeUrlKey(link(posting.url));
  const distinct = new Map<string, Record<string, unknown>>();
  for (const posting of postings) {
    const key = [urlKey(posting), field(posting.title) ?? field(posting.name), named(posting.hiringOrganization)].join('\n');
    if (!distinct.has(key)) distinct.set(key, posting);
  }
  if (distinct.size <= 1) return postings[0] ?? null;
  for (const address of pageAddresses) {
    const key = normalizeUrlKey(address);
    const matching = key === null ? [] : [...distinct.values()].filter((posting) => urlKey(posting) === key);
    if (matching.length === 1) return matching[0]!;
  }
  return null;
}

/** Where a tag of exactly this name opens, or -1: `<main>` and `<main class=…>`, not `<mainnav>` or `<main-menu>`, whose text was taken for the posting (#399). */
function opens(lower: string, name: string): number {
  for (let at = lower.indexOf(`<${name}`); at !== -1; at = lower.indexOf(`<${name}`, at + 1)) {
    const next = lower[at + name.length + 1];
    if (next === undefined || next === '>' || next === '/' || /\s/.test(next)) return at;
  }
  return -1;
}

/** Where the last closing tag of exactly this name starts, or -1. */
function closes(lower: string, name: string): number {
  for (let at = lower.lastIndexOf(`</${name}`); at !== -1; at = at === 0 ? -1 : lower.lastIndexOf(`</${name}`, at - 1)) {
    const next = lower[at + name.length + 2];
    if (next === undefined || next === '>' || /\s/.test(next)) return at;
  }
  return -1;
}

/** The page's main text: its `<main>`, else its `<article>`, else the whole page — navigation and footers are not the posting. */
function mainText(html: string): string {
  const lower = html.toLowerCase();
  for (const name of ['main', 'article']) {
    const open = opens(lower, name);
    const close = open === -1 ? -1 : closes(lower, name);
    if (close > open) {
      const text = stripHtml(html.slice(open, close));
      if (text.length >= MIN_BLOCK_TEXT_CHARS) return text;
    }
  }
  return stripHtml(html);
}

/** `savedFrom`: the address the file's wrapper gives for the page (mhtml.ts), read as the browser's own note is. */
export function readSavedPage(html: string, now: Date = new Date(), savedFrom: string | null = null): SavedPage {
  const head = html.slice(0, HEAD_CHARS);
  const postings: Record<string, unknown>[] = [];
  for (const block of structuredBlocks(html)) collectPostings(parseBlock(block), postings);
  const from = headAddresses(head, savedFrom);
  const posting = ownPosting(postings, [from.savedFrom, from.canonical, from.og]);
  // The posting as text: its block's description when that is long enough, else the page's main text.
  const textOf = (block: Record<string, unknown> | null): string => {
    const blockText = block && typeof block.description === 'string' ? stripHtml(storableText(block.description)) : '';
    return clipText(storableText(blockText.length >= MIN_BLOCK_TEXT_CHARS ? blockText : mainText(html)).trim(), MAX_POSTING_TEXT_CHARS).trim();
  };
  const text = textOf(posting);
  const titleTag = /<title\b[^<>]*>([^<]{1,1000})<\/title\s*>/i.exec(head)?.[1];
  const { address, own } = pageAddress(from, posting?.url);
  // As versions up to 2.55.11 read it: the first posting on the page, whichever the page was about.
  const first = postings[0] ?? null;
  const earlier = pageAddress(from, first?.url);
  return {
    text,
    address,
    // A list of postings has an address, and it names none of them.
    addressIsOwn: own && (posting !== null || postings.length === 0),
    facts: posting ? readFacts(posting, now) : null,
    pageTitle: titleTag === undefined ? null : field(titleTag),
    earlierKey: earlier.own && earlier.address !== null ? earlier.address : first === posting ? text : textOf(first),
  };
}
