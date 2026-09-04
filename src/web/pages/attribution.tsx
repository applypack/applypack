/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { adzunaAttribution } from '../../fetchers/adzuna';

/*
 * What a vendor's terms make us say next to a listing (ADR 0034). The
 * markup is the wording of the terms, rendered — Adzuna's asks for "Jobs by
 * Adzuna" at least 116 × 23 px, "Jobs" linked to the local domain and
 * "Adzuna" as the logo image, also linked.
 */

export const AdzunaLabel: FC<{ market: string; class?: string }> = ({ market, class: cls }) => {
  const a = adzunaAttribution(market);
  return (
    <span class={`inline-flex items-center gap-1 text-xs text-ink-muted ${cls ?? ''}`} title="Listing from the Adzuna API">
      <a href={a.url} target="_blank" rel="noopener" class="hover:underline">
        Jobs
      </a>
      <span>by</span>
      <a href={a.url} target="_blank" rel="noopener" class="inline-flex items-center">
        <img src={a.logo} alt="Adzuna" width="116" height="31" loading="lazy" class="h-[23px] w-auto" />
      </a>
    </span>
  );
};

/** The plain-text form for a Telegram line, where an image cannot go. */
export function attributionLine(atsType: string, atsToken: string): string | null {
  if (atsType !== 'ADZUNA') return null;
  try {
    return `Jobs by Adzuna — ${adzunaAttribution(atsToken).url}`;
  } catch {
    return 'Jobs by Adzuna';
  }
}
