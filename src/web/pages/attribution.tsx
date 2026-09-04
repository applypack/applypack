/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { adzunaAttribution } from '../../fetchers/adzuna';
import { FRANCE_TRAVAIL_LICENCE_URL } from '../../fetchers/francetravail';

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

/**
 * France Travail's licence, art. 4: the source, the board's last update and
 * a link to the licence, wherever an offer is shown.
 */
export const FranceTravailLine: FC<{ updatedAt: Date | null; class?: string }> = ({ updatedAt, class: cls }) => (
  <span class={`inline-flex flex-wrap items-center gap-1 text-xs text-ink-muted ${cls ?? ''}`}>
    <span>Source: France Travail{updatedAt ? ` · updated ${updatedAt.toISOString().slice(0, 10)}` : ''}</span>
    <span>·</span>
    <a href={FRANCE_TRAVAIL_LICENCE_URL} target="_blank" rel="noopener" class="hover:underline">
      licence
    </a>
    <span>·</span>
    <a href="https://github.com/applypack/applypack/blob/main/docs/france-travail-reuse.md" target="_blank" rel="noopener" class="hover:underline">
      how it is reused
    </a>
  </span>
);

/** The offer as the board sent it, every field (licence art. 5.3) — a generic tree, nothing picked or dropped. */
export const JsonTree: FC<{ value: unknown; depth?: number }> = ({ value, depth = 0 }) => {
  if (value === null || value === undefined) return <span class="text-ink-faint">—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span class="text-ink-faint">[]</span>;
    return (
      <ol class="ml-3 list-decimal space-y-1">
        {value.map((v) => (
          <li>
            <JsonTree value={v} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span class="text-ink-faint">{'{}'}</span>;
    return (
      <dl class={`${depth > 0 ? 'ml-3 ' : ''}space-y-1`}>
        {entries.map(([k, v]) => (
          <div class="grid gap-x-3 sm:grid-cols-[minmax(8rem,14rem)_1fr]">
            <dt class="font-mono text-xs text-ink-faint">{k}</dt>
            <dd class="min-w-0 break-words text-sm">
              <JsonTree value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span class="whitespace-pre-wrap">{String(value)}</span>;
};

/** The plain-text form for a Telegram line, where an image cannot go. */
export function attributionLine(atsType: string, atsToken: string): string | null {
  if (atsType === 'FRANCETRAVAIL') return `Source: France Travail — licence: ${FRANCE_TRAVAIL_LICENCE_URL}`;
  if (atsType !== 'ADZUNA') return null;
  try {
    return `Jobs by Adzuna — ${adzunaAttribution(atsToken).url}`;
  } catch {
    return 'Jobs by Adzuna';
  }
}
