import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { workplaceFromText } from '../location';
import type { NormalizedJob } from '../types';

// Pinpoint's public postings JSON: one GET, all open postings, no auth.
// Rows carry rich HTML sections and a structured compensation block but
// NO posting date — postedAt is first-seen time (F2 re-analysis).
// Invalid slugs answer 404 HTML; empty boards answer {"data":[]}.
const ENDPOINT_TEMPLATE = (slug: string) =>
  `https://${encodeURIComponent(slug)}.pinpointhq.com/postings.json`;

const PinpointPostingSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    title: z.string(),
    url: z.string(),
    description: z.string().nullable().optional(),
    key_responsibilities: z.string().nullable().optional(),
    skills_knowledge_expertise: z.string().nullable().optional(),
    employment_type_text: z.string().nullable().optional(),
    workplace_type: z.string().nullable().optional(),
    compensation: z.string().nullable().optional(),
    location: z
      .object({
        name: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

type PinpointPosting = z.infer<typeof PinpointPostingSchema>;

const PinpointResponseSchema = z
  .object({
    data: z.array(z.unknown()),
  })
  .passthrough();

export interface PinpointCompany {
  id: number;
  atsToken: string;
}

export async function fetchPinpoint(
  company: PinpointCompany,
): Promise<NormalizedJob[]> {
  const resp = await fetchWithRetry(ENDPOINT_TEMPLATE(company.atsToken));
  const raw: unknown = await resp.json();
  return mapPinpointFeed(raw, company.id);
}

export function mapPinpointFeed(
  raw: unknown,
  companyId: number,
): NormalizedJob[] {
  const top = PinpointResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: NormalizedJob[] = [];
  for (const item of top.data.data) {
    const parsed = PinpointPostingSchema.safeParse(item);
    if (!parsed.success) continue;
    out.push(toNormalized(parsed.data, companyId));
  }
  return out;
}

function toNormalized(p: PinpointPosting, companyId: number): NormalizedJob {
  return {
    companyId,
    externalId: p.id,
    title: p.title,
    url: p.url,
    location: formatLocation(p),
    description: buildDescription(p),
    postedAt: new Date(),
    // No country field at all (verified live 2026-09-03): `location.name`
    // is a country name the parser reads from the string.
    locationHints: { workplace: workplaceFromText(p.workplace_type ?? '') },
  };
}

function formatLocation(p: PinpointPosting): string {
  const place = (p.location?.name ?? p.location?.city ?? '').trim();
  const type = (p.workplace_type ?? '').trim().toLowerCase();
  const prefix =
    type === 'remote' ? 'Remote' : type === 'hybrid' ? 'Hybrid' : '';
  if (prefix.length === 0) return place;
  if (place.length === 0) return prefix;
  if (new RegExp(`\\b${prefix}\\b`, 'i').test(place)) return place;
  return `${prefix} · ${place}`;
}

// description / responsibilities / skills are separate HTML sections;
// compensation is a display string folded into text (F2 decision:
// no salary schema in v1).
function buildDescription(p: PinpointPosting): string {
  const parts: string[] = [];
  if (p.compensation && p.compensation.trim().length > 0) {
    parts.push(`Salary: ${p.compensation.trim()}.`);
  }
  if (p.employment_type_text && p.employment_type_text.trim().length > 0) {
    parts.push(`Type: ${p.employment_type_text.trim()}.`);
  }
  const header = parts.join(' ');
  const body = [p.description, p.key_responsibilities, p.skills_knowledge_expertise]
    .map((html) => (html ? stripHtml(html) : ''))
    .filter((s) => s.length > 0)
    .join('\n\n');
  if (header.length === 0) return body;
  if (body.length === 0) return header;
  return `${header}\n\n${body}`;
}
