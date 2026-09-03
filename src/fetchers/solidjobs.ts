import { z } from 'zod';
import { fetchWithRetry, sleep, stripHtml } from '../http';
import type { WorkplaceCode } from '../location';
import type { NormalizedJob } from '../types';

/**
 * solid.jobs — the Polish IT board (stage 3c, plan §4.2). Its public offers
 * API answers JSON pages of up to 500 offers with the fields a posting
 * needs: `locations[]` (Polish city names), `isRemote` / `isHybrid`,
 * `salary` in PLN per month with the employment type (B2B / UoP / UZ …),
 * `skills[{name, level}]`, `experienceLevel` and an HTML description.
 * Verified live 2026-09-03: 1 468 offers on 3 pages; the `campaign` slug is
 * mandatory (400 without it) and rides in every offer URL as the link-back;
 * robots.txt says `Allow: /` — for AI crawlers too; 300 requests/min per IP.
 * A Polish board: every row carries the PL country hint, the arrangement
 * comes from the two flags, never from the text.
 */
const ENDPOINT = 'https://solid.jobs/public-api/offers/IT';
const CAMPAIGN = 'applypack';
const API_VERSION = '1.0';
const PAGE_SIZE = 500;
const MAX_PAGES = 3;
const PAGE_DELAY_MS = 500;
/** A page is ~2.5 MB; the default 10 s is tight on a slow link. */
const TIMEOUT_MS = 20_000;

const SkillSchema = z.object({ name: z.string(), level: z.string().nullable().optional() }).passthrough();

const SalarySchema = z
  .object({
    from: z.number().nullable().optional(),
    to: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    period: z.string().nullable().optional(),
    employmentType: z.string().nullable().optional(),
  })
  .passthrough();

const SolidJobSchema = z
  .object({
    jobOfferKey: z.string().min(1),
    title: z.string(),
    url: z.string(),
    company: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    locations: z.array(z.string()).optional().default([]),
    isRemote: z.boolean().optional().default(false),
    isHybrid: z.boolean().optional().default(false),
    salary: SalarySchema.nullable().optional(),
    experienceLevel: z.string().nullable().optional(),
    contractTime: z.string().nullable().optional(),
    skills: z.array(z.unknown()).optional().default([]),
    validFrom: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

type SolidJob = z.infer<typeof SolidJobSchema>;

const SolidPageSchema = z
  .object({
    jobs: z.array(z.unknown()),
    pageIndex: z.number().optional().default(0),
    totalPages: z.number().optional().default(1),
  })
  .passthrough();

export async function fetchSolidJobs(companyId: number): Promise<NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const resp = await fetchWithRetry(solidJobsUrl(page), {
      timeoutMs: TIMEOUT_MS,
      init: { headers: { 'X-Api-Version': API_VERSION } },
    });
    const raw: unknown = await resp.json();
    const mapped = mapSolidJobsPage(raw, companyId);
    out.push(...mapped.jobs);
    if (!mapped.hasMore) break;
    if (page < MAX_PAGES - 1) await sleep(PAGE_DELAY_MS);
  }
  return out;
}

export function solidJobsUrl(page: number): string {
  return `${ENDPOINT}?campaign=${CAMPAIGN}&pageSize=${PAGE_SIZE}&pageIndex=${page}`;
}

/** Pure mapper; `hasMore` reads the page counter the API sends back. */
export function mapSolidJobsPage(raw: unknown, companyId: number): { jobs: NormalizedJob[]; hasMore: boolean } {
  const top = SolidPageSchema.safeParse(raw);
  if (!top.success) return { jobs: [], hasMore: false };
  const jobs: NormalizedJob[] = [];
  for (const item of top.data.jobs) {
    const parsed = SolidJobSchema.safeParse(item);
    if (!parsed.success) continue;
    jobs.push(toNormalized(parsed.data, companyId));
  }
  return { jobs, hasMore: top.data.pageIndex + 1 < top.data.totalPages };
}

function toNormalized(j: SolidJob, companyId: number): NormalizedJob {
  return {
    companyId,
    externalId: j.jobOfferKey,
    title: j.title.trim(),
    url: j.url,
    location: formatLocation(j),
    // The description is HTML; stripHtml decodes entities first (gotcha 12).
    description: augmentDescription(stripHtml(j.description ?? ''), j),
    postedAt: safeDate(j.validFrom) ?? safeDate(j.updatedAt) ?? new Date(),
    locationHints: { countries: ['PL'], workplace: workplaceOf(j) },
  };
}

function workplaceOf(j: SolidJob): WorkplaceCode {
  if (j.isRemote) return 'REMOTE';
  if (j.isHybrid) return 'HYBRID';
  return 'ONSITE';
}

/** "Remote or hybrid · Warszawa, Wrocław, Poland", "Hybrid · Kraków, Poland", "Poland". */
function formatLocation(j: SolidJob): string {
  const cities = j.locations.map((c) => c.trim()).filter((c) => c.length > 0);
  const place = [...cities, 'Poland'].join(', ');
  const prefix = j.isRemote ? (j.isHybrid ? 'Remote or hybrid' : 'Remote') : j.isHybrid ? 'Hybrid' : '';
  return prefix.length > 0 ? `${prefix} · ${place}` : place;
}

function augmentDescription(base: string, j: SolidJob): string {
  const parts: string[] = [];
  const company = j.company?.trim();
  if (company) parts.push(`Hiring company: ${company}.`);
  const level = j.experienceLevel?.trim();
  if (level) parts.push(`Level: ${level}.`);
  const contract = [j.salary?.employmentType?.trim(), j.contractTime?.trim().replace(/_/g, ' ')].filter(
    (s): s is string => !!s && s.length > 0,
  );
  if (contract.length > 0) parts.push(`Contract: ${contract.join(', ')}.`);
  const salary = formatSalary(j.salary);
  if (salary) parts.push(salary);
  const skills = formatSkills(j.skills);
  if (skills) parts.push(skills);
  const header = parts.join(' ');
  if (header.length === 0) return base;
  if (base.length === 0) return header;
  return `${header}\n\n${base}`;
}

function formatSalary(salary: SolidJob['salary']): string | null {
  const min = salary?.from ?? null;
  const max = salary?.to ?? null;
  if (min === null && max === null) return null;
  const range = min !== null && max !== null && min !== max ? `${Math.round(min)}-${Math.round(max)}` : `${Math.round(max ?? min ?? 0)}`;
  const currency = salary?.currency?.trim() || 'PLN';
  const period = salary?.period?.trim().toLowerCase() || 'month';
  return `Salary: ${range} ${currency} (${period}).`;
}

function formatSkills(items: unknown[]): string | null {
  const skills = items.flatMap((s) => {
    const parsed = SkillSchema.safeParse(s);
    if (!parsed.success || parsed.data.name.trim().length === 0) return [];
    const level = parsed.data.level?.trim();
    return [level ? `${parsed.data.name.trim()} (${level})` : parsed.data.name.trim()];
  });
  return skills.length > 0 ? `Skills: ${skills.join(', ')}.` : null;
}

function safeDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
