import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { conditionalHeaders, rememberResponse } from './conditional';
import { safeDate } from './dates';
import { readDetails } from './detail-memory';
import { rangeText } from './salary';
import { logger } from '../logger';
import type { NormalizedJob } from '../types';

// Rippling's public ATS board API. The list endpoint returns every job in
// one array, one row per work location (Rippling's own board: 684 rows,
// 378 postings, one of them twenty times), with no date and no text —
// those live on the per-job detail endpoint. The rows are folded into one
// posting per uuid before anything is asked, and a posting goes out only
// once its detail was read (detail-memory.ts, #658).
const LIST_URL = (slug: string) =>
  `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(slug)}/jobs`;
const DETAIL_URL = (slug: string, uuid: string) =>
  `${LIST_URL(slug)}/${encodeURIComponent(uuid)}`;
const DETAIL_DELAY_MS = 250;
const DETAIL_TIMEOUT_MS = 8_000;
/** Detail requests per read; a longer board is read over the next ticks. */
const MAX_DETAILS_PER_FETCH = 60;
/** A list longer than this is cut, and said so: the vendor pages it without end (audit FETCH-5). */
const MAX_LIST_ROWS = 1_000;

const RipplingListRowSchema = z
  .object({
    uuid: z.string(),
    name: z.string(),
    url: z.string(),
    department: z
      .object({ label: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    workLocation: z
      .object({ label: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

type RipplingListRow = z.infer<typeof RipplingListRowSchema>;

/** One posting of the list: its rows folded together, the title trimmed (#662). */
export interface RipplingPosting {
  uuid: string;
  title: string;
  url: string;
  department: string | null;
  /** Every row's work location, in list order, once each. */
  places: string[];
}

const PayRangeSchema = z
  .object({
    location: z.string().nullable().optional(),
    currency: z.string().nullable().optional(),
    frequency: z.string().nullable().optional(),
    rangeStart: z.number().nullable().optional(),
    rangeEnd: z.number().nullable().optional(),
  })
  .passthrough();

// description arrived as {company, role} HTML blocks on the boards we
// probed; tolerate a plain string in case older boards emit one.
const RipplingDetailSchema = z
  .object({
    uuid: z.string(),
    description: z
      .union([
        z.string(),
        z
          .object({
            company: z.string().nullable().optional(),
            role: z.string().nullable().optional(),
          })
          .passthrough(),
      ])
      .nullable()
      .optional(),
    createdOn: z.string().nullable().optional(),
    workLocations: z.array(z.string()).nullable().optional(),
    employmentType: z
      .object({ id: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    /** The pay ranges a posting publishes, one per place (verified live 2026-10-29). */
    payRangeDetails: z.array(PayRangeSchema).nullable().optional().catch(null),
  })
  .passthrough();

export type RipplingDetail = z.infer<typeof RipplingDetailSchema>;

/** What a detail adds to a posting — the memory keeps this, not the answer. */
export interface RipplingText {
  body: string;
  postedAt: Date;
  places: string[];
  employment: string | null;
  pay: string | null;
}

export interface RipplingCompany {
  id: number;
  atsToken: string;
}

/** Each board's details read in this process, by company id. */
const remembered = new Map<number, Map<string, RipplingText>>();

export async function fetchRippling(
  company: RipplingCompany,
): Promise<NormalizedJob[]> {
  // The list is one request per tick and the details never change its
  // validator — the same shape SmartRecruiters already revalidates.
  const listUrl = LIST_URL(company.atsToken);
  const resp = await fetchWithRetry(listUrl, { init: { headers: conditionalHeaders(company.id, listUrl) } });
  const raw: unknown = await resp.json();
  const listed = ripplingPostings(parseRipplingList(raw));
  if (listed.length > MAX_LIST_ROWS) {
    logger.warn({ atsToken: company.atsToken, listed: listed.length, kept: MAX_LIST_ROWS }, 'rippling: list cut at the cap');
  }
  const postings = listed.slice(0, MAX_LIST_ROWS);
  const memory = remembered.get(company.id) ?? new Map<string, RipplingText>();
  remembered.set(company.id, memory);
  const read = await readDetails(
    memory,
    postings.map((p) => p.uuid),
    async (uuid) => {
      const detailResp = await fetchWithRetry(DETAIL_URL(company.atsToken, uuid), { timeoutMs: DETAIL_TIMEOUT_MS });
      const parsed = RipplingDetailSchema.safeParse(await detailResp.json());
      return parsed.success ? ripplingText(parsed.data) : null;
    },
    { cap: MAX_DETAILS_PER_FETCH, delayMs: DETAIL_DELAY_MS, source: `rippling:${company.atsToken}` },
  );
  const jobs = postings.flatMap((p) => {
    const text = read.details.get(p.uuid);
    return text ? [toNormalized(p, text, company.id)] : [];
  });
  if (read.waiting > 0) {
    // A validator kept now would answer 304 next tick and hide the waiting postings.
    logger.info({ atsToken: company.atsToken, waiting: read.waiting, read: read.requested }, 'rippling: postings wait for their text until a later read');
  } else {
    rememberResponse(company.id, listUrl, resp, jobs.length);
  }
  return jobs;
}

export function parseRipplingList(raw: unknown): RipplingListRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: RipplingListRow[] = [];
  for (const item of raw) {
    const parsed = RipplingListRowSchema.safeParse(item);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

/** The list's rows folded into one posting per uuid, in list order. */
export function ripplingPostings(rows: readonly RipplingListRow[]): RipplingPosting[] {
  const byUuid = new Map<string, RipplingPosting>();
  for (const row of rows) {
    const place = (row.workLocation?.label ?? '').trim();
    const known = byUuid.get(row.uuid);
    if (known) {
      if (place && !known.places.includes(place)) known.places.push(place);
      continue;
    }
    byUuid.set(row.uuid, {
      uuid: row.uuid,
      title: row.name.trim(),
      url: row.url,
      department: row.department?.label?.trim() || null,
      places: place ? [place] : [],
    });
  }
  return [...byUuid.values()];
}

/** The parts of a detail a job is built from. */
export function ripplingText(detail: RipplingDetail): RipplingText {
  return {
    body: descriptionBody(detail.description),
    postedAt: safeDate(detail.createdOn),
    places: (detail.workLocations ?? []).map((s) => s.trim()).filter((s) => s.length > 0),
    employment: detail.employmentType?.id?.trim() || null,
    pay: payLine(detail.payRangeDetails ?? []),
  };
}

export function toNormalized(
  posting: RipplingPosting,
  text: RipplingText,
  companyId: number,
): NormalizedJob {
  const places = text.places.length > 0 ? text.places : posting.places;
  return {
    companyId,
    externalId: posting.uuid,
    title: posting.title,
    url: posting.url,
    location: places.join(' / '),
    description: buildDescription(posting, text),
    postedAt: text.postedAt,
  };
}

function buildDescription(posting: RipplingPosting, text: RipplingText): string {
  const parts: string[] = [];
  if (posting.department) parts.push(`Department: ${posting.department}.`);
  if (text.employment) parts.push(`Type: ${text.employment}.`);
  if (text.pay) parts.push(`Salary: ${text.pay}.`);
  return [parts.join(' '), text.body].filter((s) => s.length > 0).join('\n\n');
}

function descriptionBody(desc: RipplingDetail['description']): string {
  if (!desc) return '';
  if (typeof desc === 'string') return stripHtml(desc);
  return [desc.role, desc.company]
    .map((html) => (html ? stripHtml(html) : ''))
    .filter((s) => s.length > 0)
    .join('\n\n');
}

/** "207000-345000 USD (year, US San Francisco Bay Area)", one range per place. */
function payLine(ranges: readonly z.infer<typeof PayRangeSchema>[]): string | null {
  const lines = ranges.flatMap((r) => {
    const range = rangeText(r.rangeStart, r.rangeEnd);
    if (range === null) return [];
    const note = [r.frequency?.trim().toLowerCase(), r.location?.trim()].filter((s) => !!s).join(', ');
    return [`${range}${r.currency ? ` ${r.currency.trim()}` : ''}${note ? ` (${note})` : ''}`];
  });
  return lines.length > 0 ? lines.join('; ') : null;
}
