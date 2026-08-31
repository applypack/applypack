/**
 * The curated starter-pack catalog: segments of companies whose ATS board we
 * pinned and identity-checked by hand (ADR 0017). Pure — no DB, no HTTP.
 *
 * The JSON sits next to this file so `tsc` copies it into `dist/` on build.
 */

import { z } from 'zod';
import catalogJson from './catalog.json';
import { RESOLVE_ORDER } from './resolve';

const SegmentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  blurb: z.string().min(1),
});

const CompanySchema = z.object({
  name: z.string().min(1).max(100),
  segment: z.string().min(1),
  atsType: z.enum(RESOLVE_ORDER),
  atsToken: z.string().min(2).max(120),
});

const CatalogSchema = z.object({
  segments: z.array(SegmentSchema).min(1),
  companies: z.array(CompanySchema).min(1),
});

export type PackSegment = z.infer<typeof SegmentSchema>;
export type PackCompany = z.infer<typeof CompanySchema>;
export type PackCatalog = z.infer<typeof CatalogSchema>;

/**
 * Parsed once at import. A malformed catalog is a build-time mistake, so a
 * throw here is the right failure mode — the dashboard must not boot with a
 * half-valid pack list.
 */
export const CATALOG: PackCatalog = CatalogSchema.parse(catalogJson);

export function segments(): PackSegment[] {
  return CATALOG.segments;
}

/** Companies of the given segments, in catalog order. Unknown ids are ignored. */
export function companiesInSegments(segmentIds: readonly string[]): PackCompany[] {
  const wanted = new Set(segmentIds);
  return CATALOG.companies.filter((c) => wanted.has(c.segment));
}

export function countsBySegment(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of CATALOG.companies) {
    counts.set(c.segment, (counts.get(c.segment) ?? 0) + 1);
  }
  return counts;
}

/** Catalog lookup by the (segment, name) pair the confirm form round-trips. */
export function findCompany(segment: string, name: string): PackCompany | null {
  return (
    CATALOG.companies.find((c) => c.segment === segment && c.name === name) ?? null
  );
}
