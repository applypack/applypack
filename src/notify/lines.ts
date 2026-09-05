import { flagOf } from '../countries';
import { formatSalaryRange } from '../currency';
import { WORKPLACE_LABEL } from '../location';
import { describeStatus } from '../fetchers/source-health';
import type { AlertJob } from '../types';

/*
 * The words every channel says the same way, before its own markup goes on
 * (ADR 0041): the place line, the salary, the quiet-source items, the shape
 * of a page-change notice. Pure — the escaping belongs to the channel.
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
  const workplace = job.workplace && job.workplace !== 'UNKNOWN' ? WORKPLACE_LABEL[job.workplace] : '';
  const words = job.location.trim();
  const said = words.length > 0 && new RegExp(WORKPLACE_WORDS, 'i').test(words);
  const place = words.length > 0 ? words : workplace || 'Remote';
  const tail = workplace && !said && words.length > 0 ? ` · ${workplace.toLowerCase()}` : '';
  return `${flags ? `${flags} ` : ''}${place}${tail}`;
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
  /** Raw FetchStatus — rendered through describeStatus for the label. */
  status: string | null;
  streak: number;
}

/** The quiet sources as plain items — "Acme (GREENHOUSE, failing ×3)" — and how many the cap hid. */
export function quietSourceItems(sources: readonly QuietSourceAlert[]): { named: string[]; hidden: number } {
  const named = sources
    .slice(0, MAX_QUIET_NAMED)
    .map((s) => `${s.name} (${s.atsType}, ${describeStatus(s.status).label.toLowerCase()} ×${s.streak})`);
  return { named, hidden: sources.length - named.length };
}

export interface PageChangeNotice {
  companyName: string;
  url: string;
}
