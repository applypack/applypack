import { z } from 'zod';
import { fetchWithRetry } from '../http';
import type { NormalizedJob } from '../types';

// BambooHR's public careers list: one GET, no auth, list-only by design
// (no per-job detail fetch — keeps a scan bounded). The list carries no
// description and no posting date, so postedAt is first-seen time and
// Claude classifies mostly on the title (same trade-off as Workable).
// An unknown slug 302s to the www.bamboohr.com marketing site —
// `redirect: 'error'` turns that into a hard failure instead of a parse
// of the wrong page.
const ENDPOINT_TEMPLATE = (slug: string) =>
  `https://${encodeURIComponent(slug)}.bamboohr.com/careers/list`;

const BambooJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    jobOpeningName: z.string(),
    departmentLabel: z.string().nullable().optional(),
    employmentStatusLabel: z.string().nullable().optional(),
    location: z
      .object({
        city: z.string().nullable().optional(),
        state: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    isRemote: z.boolean().nullable().optional(),
  })
  .passthrough();

type BambooJob = z.infer<typeof BambooJobSchema>;

const BambooResponseSchema = z
  .object({
    result: z.array(z.unknown()),
  })
  .passthrough();

export interface BambooCompany {
  id: number;
  atsToken: string;
}

export async function fetchBamboo(
  company: BambooCompany,
): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(ENDPOINT_TEMPLATE(company.atsToken), {
    init: { redirect: 'error' },
  });
  const raw: unknown = await resp.json();
  return mapBambooFeed(raw, company.id, company.atsToken);
}

export function mapBambooFeed(
  raw: unknown,
  companyId: number,
  slug: string,
): NormalizedJob[] {
  const top = BambooResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: NormalizedJob[] = [];
  for (const item of top.data.result) {
    const parsed = BambooJobSchema.safeParse(item);
    if (!parsed.success) continue;
    out.push(toNormalized(parsed.data, companyId, slug));
  }
  return out;
}

function toNormalized(
  j: BambooJob,
  companyId: number,
  slug: string,
): NormalizedJob {
  return {
    companyId,
    externalId: j.id,
    title: j.jobOpeningName,
    url: `https://${slug}.bamboohr.com/careers/${j.id}`,
    location: formatLocation(j),
    description: buildDescription(j),
    postedAt: new Date(),
    locationHints: { workplace: j.isRemote ? 'REMOTE' : 'UNKNOWN' },
  };
}

function formatLocation(j: BambooJob): string {
  const place = [j.location?.city, j.location?.state]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join(', ');
  if (!j.isRemote) return place;
  if (place.length === 0) return 'Remote';
  return `Remote · ${place}`;
}

function buildDescription(j: BambooJob): string {
  const parts: string[] = [];
  if (j.departmentLabel && j.departmentLabel.trim().length > 0) {
    parts.push(`Department: ${j.departmentLabel.trim()}.`);
  }
  if (j.employmentStatusLabel && j.employmentStatusLabel.trim().length > 0) {
    parts.push(`Type: ${j.employmentStatusLabel.trim()}.`);
  }
  return parts.join(' ');
}
