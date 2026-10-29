import { z } from 'zod';
import { findCountry } from '../countries';
import { fetchWithRetry, stripHtml } from '../http';
import type { WorkplaceCode } from '../location';
import { logger } from '../logger';
import type { NormalizedJob } from '../types';
import { conditionalHeaders, rememberResponse } from './conditional';
import { safeDate } from './dates';
import { readDetails } from './detail-memory';

// BambooHR's public careers site: one GET for the list, which carries no
// description and no date, and one per posting for both
// (`/careers/{id}/detail`: the text as HTML, `datePosted`, `compensation`).
// A posting goes out only once its detail was read (detail-memory.ts,
// #658). An unknown slug 302s to the www.bamboohr.com marketing site —
// `redirect: 'error'` turns that into a hard failure instead of a parse of
// the wrong page.
const LIST_URL = (slug: string) =>
  `https://${encodeURIComponent(slug)}.bamboohr.com/careers/list`;
const DETAIL_URL = (slug: string, id: string) =>
  `https://${encodeURIComponent(slug)}.bamboohr.com/careers/${encodeURIComponent(id)}/detail`;
const DETAIL_DELAY_MS = 250;
const DETAIL_TIMEOUT_MS = 8_000;
/** Detail requests per read; a longer board is read over the next ticks. */
const MAX_DETAILS_PER_FETCH = 60;
/**
 * `locationType` as the careers site sends it, read off live postings on
 * 2026-10-29: "1" with no office is remote (fly.io, wirex, moodle — the
 * text says so), "2" with an office is hybrid (wirex Nicosia, fly.io
 * Chicago — "hybrid remote and in-person"). Anything else says nothing.
 */
const LOCATION_TYPE: Readonly<Record<string, WorkplaceCode>> = { '1': 'REMOTE', '2': 'HYBRID' };

const PlaceSchema = z
  .object({
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    province: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    addressCountry: z.string().nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional()
  .catch(null);

const LocationTypeSchema = z.union([z.string(), z.number()]).transform((v) => String(v)).nullable().optional().catch(null);

const BambooJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    jobOpeningName: z.string(),
    departmentLabel: z.string().nullable().optional(),
    employmentStatusLabel: z.string().nullable().optional(),
    location: PlaceSchema,
    /** Where a remote posting may be worked from. */
    atsLocation: PlaceSchema,
    isRemote: z.boolean().nullable().optional(),
    locationType: LocationTypeSchema,
  })
  .passthrough();

type BambooJob = z.infer<typeof BambooJobSchema>;
type BambooPlace = z.infer<typeof PlaceSchema>;

const BambooResponseSchema = z
  .object({
    result: z.array(z.unknown()),
  })
  .passthrough();

const BambooDetailSchema = z
  .object({
    result: z
      .object({
        jobOpening: z
          .object({
            description: z.string().nullable().optional(),
            datePosted: z.string().nullable().optional(),
            compensation: z.string().nullable().optional(),
            location: PlaceSchema,
            atsLocation: PlaceSchema,
            locationType: LocationTypeSchema,
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

/** What a detail adds to a list row — the memory keeps this, not the answer. */
export interface BambooText {
  body: string;
  postedAt: Date;
  pay: string | null;
  location: BambooPlace;
  atsLocation: BambooPlace;
  locationType: string | null;
}

export interface BambooCompany {
  id: number;
  atsToken: string;
}

/** Each board's details read in this process, by company id. */
const remembered = new Map<number, Map<string, BambooText>>();

export async function fetchBamboo(
  company: BambooCompany,
): Promise<NormalizedJob[]> {
  const url = LIST_URL(company.atsToken);
  const resp = await fetchWithRetry(url, {
    init: { redirect: 'error', headers: conditionalHeaders(company.id, url) },
  });
  const rows = bambooRows(await resp.json());
  const memory = remembered.get(company.id) ?? new Map<string, BambooText>();
  remembered.set(company.id, memory);
  const read = await readDetails(
    memory,
    rows.map((r) => r.id),
    async (id) => {
      const detail = await fetchWithRetry(DETAIL_URL(company.atsToken, id), {
        timeoutMs: DETAIL_TIMEOUT_MS,
        init: { redirect: 'error' },
      });
      return bambooText(await detail.json());
    },
    { cap: MAX_DETAILS_PER_FETCH, delayMs: DETAIL_DELAY_MS, source: `bamboohr:${company.atsToken}` },
  );
  const jobs = rows.flatMap((row) => {
    const text = read.details.get(row.id);
    return text ? [toNormalized(row, text, company.id, company.atsToken)] : [];
  });
  if (read.waiting > 0) {
    // A validator kept now would answer 304 next tick and hide the waiting postings.
    logger.info({ atsToken: company.atsToken, waiting: read.waiting, read: read.requested }, 'bamboohr: postings wait for their text until a later read');
  } else {
    rememberResponse(company.id, url, resp, jobs.length);
  }
  return jobs;
}

/** The list's rows; a payload that is not the list (the marketing page) is none. */
export function bambooRows(raw: unknown): BambooJob[] {
  const top = BambooResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: BambooJob[] = [];
  for (const item of top.data.result) {
    const parsed = BambooJobSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** The parts of a `/careers/{id}/detail` answer a job is built from; null when it is not one. */
export function bambooText(raw: unknown): BambooText | null {
  const parsed = BambooDetailSchema.safeParse(raw);
  if (!parsed.success) return null;
  const j = parsed.data.result.jobOpening;
  return {
    body: stripHtml(j.description ?? ''),
    postedAt: safeDate(j.datePosted),
    pay: j.compensation?.trim() || null,
    location: j.location,
    atsLocation: j.atsLocation,
    locationType: j.locationType ?? null,
  };
}

export function toNormalized(
  row: BambooJob,
  text: BambooText,
  companyId: number,
  slug: string,
): NormalizedJob {
  const workplace = workplaceOf(text.locationType ?? row.locationType ?? null, row.isRemote);
  // A remote posting names where it may be worked from; any other, its office.
  const place = workplace === 'REMOTE' ? merged(text.atsLocation, row.atsLocation) : merged(text.location, row.location);
  const country = place.country ? findCountry(place.country)?.code : undefined;
  return {
    companyId,
    externalId: row.id,
    title: row.jobOpeningName.trim(),
    url: `https://${slug}.bamboohr.com/careers/${row.id}`,
    location: formatLocation(workplace, place),
    description: buildDescription(row, text),
    postedAt: text.postedAt,
    locationHints: { workplace, ...(country && { countries: [country] }) },
  };
}

function workplaceOf(locationType: string | null, isRemote: boolean | null | undefined): WorkplaceCode {
  return (locationType ? LOCATION_TYPE[locationType] : undefined) ?? (isRemote ? 'REMOTE' : 'UNKNOWN');
}

/** The detail's place, the list's where the detail says nothing. */
function merged(detail: BambooPlace, list: BambooPlace): { parts: string[]; country: string | null } {
  const pick = (key: 'city' | 'state' | 'province') => (detail?.[key] || list?.[key] || '').trim();
  const country = (detail?.country || detail?.addressCountry || list?.country || list?.addressCountry || '').trim();
  const parts: string[] = [];
  for (const part of [pick('city'), pick('state') || pick('province'), country]) {
    if (part.length > 0 && !parts.some((p) => p.toLowerCase() === part.toLowerCase())) parts.push(part);
  }
  return { parts, country: country || null };
}

function formatLocation(workplace: WorkplaceCode, place: { parts: string[] }): string {
  const where = place.parts.join(', ');
  const prefix = workplace === 'REMOTE' ? 'Remote' : workplace === 'HYBRID' ? 'Hybrid' : '';
  if (!prefix) return where;
  return where ? `${prefix} · ${where}` : prefix;
}

function buildDescription(row: BambooJob, text: BambooText): string {
  const parts: string[] = [];
  if (row.departmentLabel && row.departmentLabel.trim().length > 0) {
    parts.push(`Department: ${row.departmentLabel.trim()}.`);
  }
  if (row.employmentStatusLabel && row.employmentStatusLabel.trim().length > 0) {
    parts.push(`Type: ${row.employmentStatusLabel.trim()}.`);
  }
  if (text.pay) parts.push(`Salary: ${text.pay}.`);
  return [parts.join(' '), text.body].filter((s) => s.length > 0).join('\n\n');
}
