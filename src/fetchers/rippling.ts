import { z } from 'zod';
import { fetchWithRetry, sleep, stripHtml } from '../http';
import { logger } from '../logger';
import type { NormalizedJob } from '../types';

// Rippling's public ATS board API. The list endpoint returns every job
// in one array but carries no date and no description — those live on
// the per-job detail endpoint (SmartRecruiters pattern: capped detail
// fetches with polite pacing; rows past the cap still ship title-only).
const LIST_URL = (slug: string) =>
  `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(slug)}/jobs`;
const DETAIL_URL = (slug: string, uuid: string) =>
  `${LIST_URL(slug)}/${encodeURIComponent(uuid)}`;
const DETAIL_DELAY_MS = 250;
const MAX_DETAILS_PER_FETCH = 60;

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

export type RipplingListRow = z.infer<typeof RipplingListRowSchema>;

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
  })
  .passthrough();

export type RipplingDetail = z.infer<typeof RipplingDetailSchema>;

export interface RipplingCompany {
  id: number;
  atsToken: string;
}

export async function fetchRippling(
  company: RipplingCompany,
): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(LIST_URL(company.atsToken));
  const raw: unknown = await resp.json();
  const rows = parseRipplingList(raw);

  const out: NormalizedJob[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let detail: RipplingDetail | null = null;
    if (i < MAX_DETAILS_PER_FETCH) {
      try {
        const detailResp = await fetchWithRetry(
          DETAIL_URL(company.atsToken, row.uuid),
          { timeoutMs: 8_000 },
        );
        const detailRaw: unknown = await detailResp.json();
        const parsed = RipplingDetailSchema.safeParse(detailRaw);
        if (parsed.success) detail = parsed.data;
      } catch (err) {
        logger.warn(
          { err, atsToken: company.atsToken, uuid: row.uuid },
          'rippling: detail fetch failed',
        );
      }
      await sleep(DETAIL_DELAY_MS);
    }
    out.push(toNormalized(row, detail, company.id));
  }
  return out;
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

export function toNormalized(
  row: RipplingListRow,
  detail: RipplingDetail | null,
  companyId: number,
): NormalizedJob {
  const locations = (detail?.workLocations ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    companyId,
    externalId: row.uuid,
    title: row.name,
    url: row.url,
    location:
      locations.length > 0
        ? locations.join(' / ')
        : (row.workLocation?.label ?? '').trim(),
    description: buildDescription(row, detail),
    postedAt: safeDate(detail?.createdOn),
  };
}

function buildDescription(
  row: RipplingListRow,
  detail: RipplingDetail | null,
): string {
  const parts: string[] = [];
  const department = row.department?.label?.trim();
  if (department) parts.push(`Department: ${department}.`);
  const employment = detail?.employmentType?.id?.trim();
  if (employment) parts.push(`Type: ${employment}.`);
  const header = parts.join(' ');
  const body = descriptionBody(detail);
  if (header.length === 0) return body;
  if (body.length === 0) return header;
  return `${header}\n\n${body}`;
}

function descriptionBody(detail: RipplingDetail | null): string {
  const desc = detail?.description;
  if (!desc) return '';
  if (typeof desc === 'string') return stripHtml(desc);
  return [desc.role, desc.company]
    .map((html) => (html ? stripHtml(html) : ''))
    .filter((s) => s.length > 0)
    .join('\n\n');
}

function safeDate(s: string | null | undefined): Date {
  if (!s) return new Date();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
