import { z } from 'zod';
import { findCountry } from '../countries';
import { fetchWithRetry, sleep } from '../http';
import { workplaceFromText } from '../location';
import type { NormalizedJob } from '../types';

// 4dayweek.io publishes a versioned public API; robots.txt disallows
// /api/ but explicitly allows /api/v1 and /api/v2, so v2 it is (F2
// re-analysis — never the unversioned path). 25 jobs/page newest-first;
// three pages per tick is plenty at our hourly cadence, and the API
// rate limit is 60 req/min.
const PAGE_URL = (page: number) => `https://4dayweek.io/api/v2/jobs?page=${page}`;
const MAX_PAGES = 3;
const PAGE_DELAY_MS = 1_000;

// Salary values arrive in minor units (4200000 GBP year = £42,000).
const SALARY_MINOR_UNITS = 100;

const FourDayWeekJobSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
    description: z.string().nullable().optional(),
    posted_at: z.string().nullable().optional(),
    company: z
      .object({ name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    locations: z
      .array(
        z
          .object({
            city: z.string().nullable().optional(),
            country: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    work_arrangement: z.string().nullable().optional(),
    contract_type: z.string().nullable().optional(),
    level: z.string().nullable().optional(),
    hours_per_week_min: z.number().nullable().optional(),
    hours_per_week_max: z.number().nullable().optional(),
    salary_min: z.number().nullable().optional(),
    salary_max: z.number().nullable().optional(),
    salary_currency: z.string().nullable().optional(),
    salary_period: z.string().nullable().optional(),
  })
  .passthrough();

type FourDayWeekJob = z.infer<typeof FourDayWeekJobSchema>;

const FourDayWeekPageSchema = z
  .object({
    data: z.array(z.unknown()),
    has_more: z.boolean().optional().default(false),
  })
  .passthrough();

export async function fetchFourDayWeek(
  companyId: number,
): Promise<NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await fetchWithRetry(PAGE_URL(page));
    const raw: unknown = await resp.json();
    const mapped = mapFourDayWeekPage(raw, companyId);
    out.push(...mapped.jobs);
    if (!mapped.hasMore) break;
    if (page < MAX_PAGES) await sleep(PAGE_DELAY_MS);
  }
  return out;
}

export function mapFourDayWeekPage(
  raw: unknown,
  companyId: number,
): { jobs: NormalizedJob[]; hasMore: boolean } {
  const top = FourDayWeekPageSchema.safeParse(raw);
  if (!top.success) return { jobs: [], hasMore: false };
  const jobs: NormalizedJob[] = [];
  for (const item of top.data.data) {
    const parsed = FourDayWeekJobSchema.safeParse(item);
    if (!parsed.success) continue;
    jobs.push(toNormalized(parsed.data, companyId));
  }
  return { jobs, hasMore: top.data.has_more };
}

function toNormalized(j: FourDayWeekJob, companyId: number): NormalizedJob {
  return {
    companyId,
    externalId: j.id,
    title: j.title,
    url: j.url,
    location: formatLocation(j),
    // description is markdown-ish plaintext, NOT HTML — running a tag
    // strip over it would collapse its real newlines (gotcha 12).
    description: augmentDescription((j.description ?? '').trim(), j),
    postedAt: safeDate(j.posted_at),
    // `locations[].country` are geocoded names (verified live 2026-09-03).
    locationHints: {
      countries: j.locations.flatMap((l) => findCountry(l.country ?? '')?.code ?? []),
      workplace: workplaceFromText(j.work_arrangement ?? ''),
    },
  };
}

function formatLocation(j: FourDayWeekJob): string {
  const places = j.locations
    .map((l) =>
      [l.city, l.country]
        .map((s) => (s ?? '').trim())
        .filter((s) => s.length > 0)
        .join(', '),
    )
    .filter((s) => s.length > 0);
  const place = places.join(' / ');
  const arrangement = (j.work_arrangement ?? '').trim().toLowerCase();
  const prefix = arrangement.includes('remote')
    ? 'Remote'
    : arrangement === 'hybrid'
      ? 'Hybrid'
      : '';
  if (prefix.length === 0) return place;
  if (place.length === 0) return prefix;
  return `${prefix} · ${place}`;
}

function augmentDescription(base: string, j: FourDayWeekJob): string {
  const parts: string[] = [];
  const company = j.company?.name?.trim();
  if (company) parts.push(`Hiring company: ${company}.`);
  if (j.contract_type && j.contract_type.trim().length > 0) {
    parts.push(`Type: ${j.contract_type.trim()}.`);
  }
  if (j.level && j.level.trim().length > 0) {
    parts.push(`Level: ${j.level.trim()}.`);
  }
  const hours = formatHours(j);
  if (hours) parts.push(hours);
  const salary = formatSalary(j);
  if (salary) parts.push(salary);
  const header = parts.join(' ');
  if (header.length === 0) return base;
  if (base.length === 0) return header;
  return `${header}\n\n${base}`;
}

function formatHours(j: FourDayWeekJob): string | null {
  const min = j.hours_per_week_min ?? null;
  const max = j.hours_per_week_max ?? null;
  if (min === null && max === null) return null;
  const range = min !== null && max !== null && min !== max ? `${min}-${max}` : `${max ?? min}`;
  return `Hours: ${range}/week.`;
}

function formatSalary(j: FourDayWeekJob): string | null {
  const min = toMajor(j.salary_min);
  const max = toMajor(j.salary_max);
  if (min === null && max === null) return null;
  const currency = j.salary_currency?.trim() || 'USD';
  const period = j.salary_period?.trim() || 'year';
  const range =
    min !== null && max !== null && min !== max
      ? `${min}-${max}`
      : `${max ?? min}`;
  return `Salary: ${range} ${currency} (${period}).`;
}

function toMajor(minor: number | null | undefined): number | null {
  if (typeof minor !== 'number' || minor <= 0) return null;
  return Math.round(minor / SALARY_MINOR_UNITS);
}

function safeDate(s: string | null | undefined): Date {
  if (!s) return new Date();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
