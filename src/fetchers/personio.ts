import { decodeHtmlEntities, fetchWithRetry, stripHtml } from '../http';
import type { NormalizedJob } from '../types';

/**
 * Personio — the DACH mid-market ATS (stage 3d, plan §4.2). Every customer
 * has a public, documented XML feed at `{slug}.jobs.personio.de/xml`
 * (`.com` serves the same); `?language=en` is what fills the descriptions.
 * Verified live 2026-09-03 on holidu (54 positions), ottonova, everphone,
 * personio: a `<workzag-jobs>` root of `<position>` blocks with id,
 * subcompany, office, additionalOffices/office, department, name,
 * jobDescriptions/jobDescription{name, value (CDATA HTML)}, employmentType,
 * seniority, schedule, yearsOfExperience, salaryInformation, createdAt. No
 * country, no remote flag, no URL: `office` is what the employer typed
 * ("Munich, Germany", "München", "Remote Italy", a street address) and goes
 * to the parser as is; the URL is built from the id. An unknown slug is a
 * 307 to personio.com whose target answers 429 — the fetch refuses
 * redirects, so that is reported as "no feed", never as a rate limit. The
 * XML is flat enough to read without a dependency.
 */
const FEED_HOST_RE = /^(?:https?:\/\/)?([a-z0-9-]{2,60})\.jobs\.personio\.(?:de|com)(?:[/?#].*)?$/i;
const SLUG_RE = /^[a-z0-9-]{2,60}$/i;
const TIMEOUT_MS = 20_000;
/** A section Personio adds for its own UI, not part of the posting. */
const SKIPPED_SECTIONS = new Set(['CONTACT_PERSON']);

export interface PersonioCompany {
  id: number;
  /** A slug ("holidu") or the feed host ("holidu.jobs.personio.de"). */
  atsToken: string;
}

export interface PersonioPosition {
  id: string;
  name: string;
  subcompany: string | null;
  offices: string[];
  department: string | null;
  employmentType: string | null;
  seniority: string | null;
  schedule: string | null;
  yearsOfExperience: string | null;
  salary: string | null;
  createdAt: string | null;
  /** Section title → HTML, in feed order. */
  sections: { name: string; html: string }[];
}

export async function fetchPersonio(company: PersonioCompany): Promise<NormalizedJob[]> {
  const slug = personioSlug(company.atsToken);
  const resp = await fetchWithRetry(personioFeedUrl(slug), { timeoutMs: TIMEOUT_MS, init: { redirect: 'error' } });
  const xml = await resp.text();
  if (!isPersonioFeed(xml)) throw new Error(`personio: "${slug}" answered no job feed (expected <workzag-jobs>)`);
  return parsePersonioXml(xml).map((p) => mapPersonioPosition(p, company.id, slug));
}

export function personioFeedUrl(slug: string): string {
  return `https://${slug}.jobs.personio.de/xml?language=en`;
}

/** The slug of a token given as a slug or as the feed host; anything else refused. */
export function personioSlug(token: string): string {
  const trimmed = token.trim();
  const host = FEED_HOST_RE.exec(trimmed);
  const slug = (host?.[1] ?? trimmed).toLowerCase();
  if (!SLUG_RE.test(slug)) throw new Error(`personio: "${token}" is neither a slug nor a *.jobs.personio.de host`);
  return slug;
}

export function isPersonioFeed(xml: string): boolean {
  return /<workzag-jobs[\s>]/.test(xml);
}

/** The `<position>` blocks of a feed as records; a block without an id or a name is skipped. */
export function parsePersonioXml(xml: string): PersonioPosition[] {
  const out: PersonioPosition[] = [];
  for (const m of xml.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
    const block = m[1] ?? '';
    const id = text(block, 'id');
    const name = text(block, 'name');
    if (!id || !name) continue;
    const salary = /<salaryInformation>([\s\S]*?)<\/salaryInformation>/.exec(block)?.[1] ?? '';
    out.push({
      id,
      name,
      subcompany: text(block, 'subcompany') || null,
      offices: offices(block),
      department: text(block, 'department') || null,
      employmentType: text(block, 'employmentType') || null,
      seniority: text(block, 'seniority') || null,
      schedule: text(block, 'schedule') || null,
      yearsOfExperience: text(block, 'yearsOfExperience') || null,
      salary: formatSalary(salary),
      createdAt: text(block, 'createdAt') || null,
      sections: sections(block),
    });
  }
  return out;
}

/** Pure mapper; the URL is built from the id, the offices go to the parser as typed. */
export function mapPersonioPosition(p: PersonioPosition, companyId: number, slug: string): NormalizedJob {
  const created = new Date(p.createdAt ?? '');
  return {
    companyId,
    externalId: p.id,
    title: p.name,
    url: `https://${slug}.jobs.personio.de/job/${encodeURIComponent(p.id)}?language=en`,
    location: p.offices.join(' / '),
    description: buildDescription(p),
    postedAt: Number.isNaN(created.getTime()) ? new Date() : created,
  };
}

function buildDescription(p: PersonioPosition): string {
  const head: string[] = [];
  if (p.subcompany) head.push(`Hiring company: ${p.subcompany}.`);
  if (p.department) head.push(`Department: ${p.department}.`);
  const employment = [p.employmentType, p.schedule].filter((s): s is string => !!s).map(humanize);
  if (employment.length > 0) head.push(`Employment: ${employment.join(', ')}.`);
  if (p.seniority) head.push(`Seniority: ${humanize(p.seniority)}.`);
  if (p.yearsOfExperience) head.push(`Experience: ${p.yearsOfExperience} years.`);
  if (p.salary) head.push(`Salary: ${p.salary}.`);
  const body = p.sections
    .filter((s) => !SKIPPED_SECTIONS.has(s.name))
    .map((s) => {
      // The value is HTML; stripHtml decodes entities first (gotcha 12).
      const textBody = stripHtml(s.html);
      return s.name && textBody ? `${s.name}\n\n${textBody}` : textBody || s.name;
    })
    .filter((s) => s.length > 0);
  return [head.join(' '), ...body].filter((s) => s.length > 0).join('\n\n');
}

/** "full_or_part_time" / "full-or-part-time" → "full or part time". */
function humanize(code: string): string {
  return code.replace(/[_-]+/g, ' ').trim();
}

/** The main office followed by the additional ones, once each. */
function offices(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/<office>([\s\S]*?)<\/office>/g)) {
    const office = unwrap(m[1] ?? '');
    if (office.length > 0 && !out.includes(office)) out.push(office);
  }
  return out;
}

function sections(block: string): { name: string; html: string }[] {
  const list = /<jobDescriptions>([\s\S]*?)<\/jobDescriptions>/.exec(block)?.[1] ?? '';
  const out: { name: string; html: string }[] = [];
  for (const m of list.matchAll(/<jobDescription>([\s\S]*?)<\/jobDescription>/g)) {
    const item = m[1] ?? '';
    const html = cdata(/<value>([\s\S]*?)<\/value>/.exec(item)?.[1] ?? '');
    out.push({ name: text(item, 'name'), html });
  }
  return out;
}

/** "<min>60000</min><currencySymbol>€</currencySymbol>…" → "€ 60000 (per year)". */
function formatSalary(inner: string): string | null {
  if (inner.trim().length === 0) return null;
  const min = text(inner, 'min');
  const max = text(inner, 'max');
  const currency = text(inner, 'currencySymbol') || text(inner, 'currencyCode');
  const type = text(inner, 'type');
  const range = min && max && min !== max ? `${min}-${max}` : max || min;
  if (!range) return null;
  return `${currency ? `${currency} ` : ''}${range}${type ? ` (${humanize(type)})` : ''}`;
}

/** The decoded text of the first `<tag>` in a block, '' when absent. */
function text(block: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? unwrap(m[1] ?? '') : '';
}

/** CDATA unwrapped and entities decoded, trimmed. */
function unwrap(raw: string): string {
  return decodeHtmlEntities(cdata(raw)).trim();
}

function cdata(raw: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return m ? (m[1] ?? '') : raw;
}
