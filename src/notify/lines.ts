import { flagOf } from '../countries';
import { formatSalaryRange } from '../currency';
import { workplaceName } from '../i18n/places';
import { t } from '../i18n/t';
import type { AlertJob } from '../types';

/*
 * The words every channel says the same way, before its own markup goes on
 * (ADR 0041): the place line, the salary, the quiet-source list, the shape
 * of a page-change notice. Pure — the escaping belongs to the channel. The
 * words are the catalog's, in the language of the run (ADR 0061); a
 * posting's own title, company and place stay as posted.
 */

/** Arrangement words a location string may already carry. */
const WORKPLACE_WORDS = '\\b(remote|hybrid|on-?site|in-office)\\b';

/**
 * Quiet sources named in full before the line collapses to a count. A total
 * outage marks every source at once, and an uncapped list would push a
 * digest header past a channel's limit — Telegram then rejects the whole
 * message, losing the alert exactly when it matters most.
 */
const MAX_QUIET_NAMED = 8;

/**
 * The place line: the posting's own words, the flags of the countries the
 * stage-1 columns hold, and the arrangement when the words do not already
 * say it (ADR 0033). "🇩🇪 Remote · Berlin, Germany", "🇺🇦 Kyiv · hybrid".
 */
export function formatPlaceLine(job: AlertJob): string {
  const flags = (job.countries ?? []).map(flagOf).filter((f) => f.length > 0).join('');
  const workplace = job.workplace && job.workplace !== 'UNKNOWN' ? job.workplace : null;
  const words = job.location.trim();
  const said = words.length > 0 && new RegExp(WORKPLACE_WORDS, 'i').test(words);
  const place =
    words.length === 0
      ? workplaceName(workplace ?? 'REMOTE')
      : workplace && !said
        ? t('notify.place.withArrangement', { place: words, workplace })
        : words;
  return `${flags ? `${flags} ` : ''}${place}`;
}

/** The posting's own money and period (src/currency.ts); null columns read as USD a year. */
export function formatSalary(
  min: number | null,
  max: number | null,
  currency?: string | null,
  period?: string | null,
): string {
  return formatSalaryRange(min, max, currency, period);
}

export interface QuietSourceAlert {
  name: string;
  atsType: string;
  /** Raw FetchStatus — worded by the `sourceHealth.item` message. */
  status: string | null;
  streak: number;
}

/**
 * The quiet sources as one plain list — "Acme (GREENHOUSE, slug not found ×3),
 * …, and 63 more" — the cap's remainder counted at its end.
 */
export function quietSourceList(sources: readonly QuietSourceAlert[]): string {
  const named = sources
    .slice(0, MAX_QUIET_NAMED)
    // A status the build does not know, or none yet, reads as "not fetched yet" (the select's `other`).
    .map((s) => t('sourceHealth.item', { name: s.name, ats: s.atsType, status: s.status ?? 'none', streak: s.streak }));
  const hidden = sources.length - named.length;
  return [...named, ...(hidden > 0 ? [t('sourceHealth.more', { n: hidden })] : [])].join(', ');
}

export interface PageChangeNotice {
  companyName: string;
  url: string;
}
