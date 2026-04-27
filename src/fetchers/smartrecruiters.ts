import { z } from 'zod';
import { fetchWithRetry, sleep, stripHtml } from '../http';
import { logger } from '../logger';
import type { NormalizedJob } from '../types';

const LIST_LIMIT = 100;
const DETAIL_DELAY_MS = 250; // SmartRecruiters tolerates ~5 req/s
const MAX_DETAILS_PER_FETCH = 60; // cap per cycle to keep latency sane

const SrLocationSchema = z
  .object({
    city: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    fullLocation: z.string().nullable().optional(),
    remote: z.boolean().optional().default(false),
    hybrid: z.boolean().optional().default(false),
  })
  .passthrough();

const SrPostingSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    refNumber: z.string().optional(),
    releasedDate: z.string().optional(),
    location: SrLocationSchema.nullable().optional(),
    company: z
      .object({ identifier: z.string().optional(), name: z.string().optional() })
      .nullable()
      .optional(),
    ref: z.string().optional(),
  })
  .passthrough();

const SrListSchema = z
  .object({
    totalFound: z.number().optional(),
    content: z.array(z.unknown()),
  })
  .passthrough();

// Detail endpoint shape — only the bits we use.
const SrDetailSchema = z
  .object({
    id: z.string(),
    postingUrl: z.string().optional(),
    applyUrl: z.string().optional(),
    jobAd: z
      .object({
        sections: z
          .object({
            companyDescription: z
              .object({ text: z.string().optional() })
              .nullable()
              .optional(),
            jobDescription: z
              .object({ text: z.string().optional() })
              .nullable()
              .optional(),
            qualifications: z
              .object({ text: z.string().optional() })
              .nullable()
              .optional(),
            additionalInformation: z
              .object({ text: z.string().optional() })
              .nullable()
              .optional(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

export interface SmartRecruitersCompany {
  id: number;
  atsToken: string;
}

export async function fetchSmartRecruiters(
  company: SmartRecruitersCompany,
): Promise<NormalizedJob[]> {
  const listUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.atsToken)}/postings?limit=${LIST_LIMIT}`;
  const resp = await fetchWithRetry(listUrl);
  const raw: unknown = await resp.json();
  const list = SrListSchema.safeParse(raw);
  if (!list.success) {
    logger.warn(
      { errors: list.error.flatten().fieldErrors, atsToken: company.atsToken },
      'smartrecruiters: list schema mismatch',
    );
    return [];
  }
  // Normalise list rows
  const postings: z.infer<typeof SrPostingSchema>[] = [];
  for (const item of list.data.content) {
    const parsed = SrPostingSchema.safeParse(item);
    if (parsed.success) postings.push(parsed.data);
  }

  // Fetch details for up to MAX_DETAILS_PER_FETCH. Beyond that we still
  // emit jobs with empty descriptions so the base-filter / Claude can
  // at least judge by title.
  const out: NormalizedJob[] = [];
  for (let i = 0; i < postings.length; i++) {
    const p = postings[i]!;
    let description = '';
    let url = p.ref ?? '';

    if (i < MAX_DETAILS_PER_FETCH) {
      const detailUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.atsToken)}/postings/${encodeURIComponent(p.id)}`;
      try {
        const detailResp = await fetchWithRetry(detailUrl, { timeoutMs: 8_000 });
        const detailRaw: unknown = await detailResp.json();
        const detail = SrDetailSchema.safeParse(detailRaw);
        if (detail.success) {
          const sec = detail.data.jobAd?.sections;
          description = stripHtml(
            [
              sec?.companyDescription?.text,
              sec?.jobDescription?.text,
              sec?.qualifications?.text,
              sec?.additionalInformation?.text,
            ]
              .filter(Boolean)
              .join('\n\n'),
          );
          url = detail.data.postingUrl ?? detail.data.applyUrl ?? url;
        }
      } catch (err) {
        logger.warn(
          { err, atsToken: company.atsToken, postingId: p.id },
          'smartrecruiters: detail fetch failed',
        );
      }
      await sleep(DETAIL_DELAY_MS);
    }

    out.push({
      companyId: company.id,
      externalId: p.id,
      title: p.name,
      url,
      location: formatLocation(p.location ?? null),
      description,
      postedAt: p.releasedDate ? safeDate(p.releasedDate) : new Date(),
    });
  }
  return out;
}

function formatLocation(
  loc: z.infer<typeof SrLocationSchema> | null,
): string {
  if (!loc) return '';
  if (loc.fullLocation && loc.fullLocation.trim().length > 0) {
    const prefix = loc.remote ? 'Remote · ' : loc.hybrid ? 'Hybrid · ' : '';
    return `${prefix}${loc.fullLocation}`;
  }
  const parts = [loc.city, loc.region, loc.country].filter(
    (v) => typeof v === 'string' && v.trim().length > 0,
  );
  const place = parts.join(', ');
  const prefix = loc.remote ? 'Remote · ' : loc.hybrid ? 'Hybrid · ' : '';
  return place.length > 0 ? `${prefix}${place}` : loc.remote ? 'Remote' : '';
}

function safeDate(s: string): Date {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
