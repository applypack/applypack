import { SOURCE_LOCALE, currentLocale, intlTag } from './locale';
import { marked } from './pseudo';

/*
 * Numbers, dates, lists and names in the language of the moment (ADR 0061):
 * the one place the interface calls `Intl` with a language. Digits are Latin
 * in every language (locale.ts gives each tag its numbering system). A date
 * needs its zone from the caller — the dashboard's is web/display-zone.ts.
 *
 * `'en-US'` written out elsewhere in the code is not an oversight where it is
 * a computation (user-schedule.ts reading the weekday), a prompt or a CSV:
 * those do not follow the reader's language.
 */

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const listFormats = new Map<string, Intl.ListFormat>();
const regionNames = new Map<string, Intl.DisplayNames>();

function cached<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let value = cache.get(key);
  if (value === undefined) cache.set(key, (value = make()));
  return value;
}

export function formatNumber(n: number, options: Intl.NumberFormatOptions = {}): string {
  const tag = intlTag();
  return marked(cached(numberFormats, `${tag}\n${JSON.stringify(options)}`, () => new Intl.NumberFormat(tag, options)).format(n));
}

/** `options` name the fields and the zone, as `toLocaleString` took them. */
export function formatDateTime(d: Date, options: Intl.DateTimeFormatOptions): string {
  const tag = intlTag();
  return marked(cached(dateFormats, `${tag}\n${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(tag, options)).format(d));
}

/**
 * A span of days as the language writes it: "Sep 16 – 18", "16–18 вер.",
 * "Sep 29 – Oct 1". ICU sets the dash in thin spaces; they are written as
 * plain ones, which is what a table cell and a test both expect. Across New
 * Year ICU adds the years the options left out, so the two days are written
 * apart instead: "Dec 30 – Jan 1".
 */
export function formatDateRange(from: Date, to: Date, options: Intl.DateTimeFormatOptions): string {
  const tag = intlTag();
  const format = cached(dateFormats, `${tag}\n${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(tag, options));
  const addsYear = options.year === undefined && format.formatRangeToParts(from, to).some((part) => part.type === 'year');
  const text = addsYear ? `${format.format(from)} – ${format.format(to)}` : format.formatRange(from, to);
  return marked(text.replace(/\u2009/g, ' '));
}

/** One named part of a date ("GMT+3" for `timeZoneName`), or null when the format has none. */
export function formatDatePart(d: Date, options: Intl.DateTimeFormatOptions, part: Intl.DateTimeFormatPartTypes): string | null {
  const tag = intlTag();
  const format = cached(dateFormats, `${tag}\n${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(tag, options));
  const value = format.formatToParts(d).find((p) => p.type === part)?.value;
  return value === undefined ? null : marked(value);
}

/** "a, b and c" (`conjunction`) or "a, b or c" (`disjunction`), as the language joins them. */
export function formatList(items: readonly string[], type: 'conjunction' | 'disjunction' | 'unit' = 'conjunction'): string {
  const tag = intlTag();
  // `unit` is a short run of like things ("№3, №4 and №5"), the way public/i18n.mjs:formatList joins them.
  const options: Intl.ListFormatOptions = type === 'unit' ? { type, style: 'short' } : { type };
  return marked(cached(listFormats, `${tag}\n${type}`, () => new Intl.ListFormat(tag, options)).format(items));
}

/** 2024-01-01 was a Monday: day N of that month is ISO weekday N. */
const A_MONDAY = { year: 2024, month: 0 };

/** The name of an ISO weekday (1 = Monday … 7 = Sunday). */
export function weekdayName(isoDay: number, width: 'short' | 'long' = 'short'): string {
  return formatDateTime(new Date(Date.UTC(A_MONDAY.year, A_MONDAY.month, isoDay)), { weekday: width, timeZone: 'UTC' });
}

/**
 * A country's name in the reader's language. In English it is `own` — the
 * gazetteer's wording (countries.json), which the filters and the tests
 * already speak; elsewhere it is CLDR's, and `own` again for a code CLDR
 * does not name (a group such as DACH).
 */
export function regionName(code: string, own: string): string {
  const locale = currentLocale();
  if (locale === SOURCE_LOCALE) return own;
  const tag = intlTag(locale);
  try {
    return marked(cached(regionNames, tag, () => new Intl.DisplayNames(tag, { type: 'region', fallback: 'none' })).of(code) ?? own);
  } catch {
    // Not a region code at all.
    return marked(own);
  }
}
