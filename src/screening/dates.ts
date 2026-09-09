/*
 * Dates as resumes write them (TASKS §19.1: "dates are strings → a date
 * parser"), and the arithmetic the score reads off them: how many years
 * the relevant roles cover, and how long ago the last one ended. Pure.
 *
 * The strings arrive verbatim from the resume — the model copies them and
 * anchor.ts drops any it did not — so this reads the shapes the corpus
 * actually writes: "Jan 2020", "January 2020", "01/2020", "2020-01",
 * "03.2019", "2018", and the "still there" words in English, Ukrainian,
 * Russian, German and Polish. A bare year is January of that year for a
 * start and December for an end, so a "2019 – 2020" role is a full year.
 */

export interface ParsedDate {
  year: number;
  /** 1–12, or null when the resume gave only the year. */
  month: number | null;
}

export type DateMark = ParsedDate | 'present';

export interface DateRange {
  from: ParsedDate;
  to: ParsedDate;
}

const MIN_YEAR = 1960;

/** One stem per month, per language; a stem matches the start of the word ("січ" → січень, січня). */
const MONTH_STEMS: string[][] = [
  ['jan', 'січ', 'янв', 'sty'],
  ['feb', 'лют', 'фев', 'lut'],
  ['mar', 'mär', 'бер', 'мар', 'marz'],
  ['apr', 'кві', 'апр', 'kwi'],
  ['may', 'mai', 'тра', 'мая', 'май', 'maj'],
  ['jun', 'чер', 'июн', 'cze'],
  ['jul', 'лип', 'июл', 'lip'],
  ['aug', 'сер', 'авг', 'sie'],
  ['sep', 'вер', 'сен', 'wrz'],
  ['oct', 'okt', 'жов', 'окт', 'paź', 'paz'],
  ['nov', 'лис', 'ноя', 'lis'],
  ['dec', 'dez', 'гру', 'дек', 'gru'],
];

/** JS's \b is ASCII-only, so the word edges are spelled out for the Cyrillic entries. */
const PRESENT_WORDS =
  /(?<![\p{L}\p{N}])(present|current|currently|now|today|ongoing|дотепер|до тепер|зараз|теперішн\p{L}*|цей час|донині|настоящее|сейчас|по н\.в\.|heute|aktuell|derzeit|obecnie|teraz|nadal|dziś)(?![\p{L}\p{N}])/iu;

const YEAR = /\b(19[6-9]\d|20[0-4]\d)\b/;

/** A date as a resume writes it → year + month, "present", or null when it is not a date. */
export function parseResumeDate(raw: string | null | undefined): DateMark | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ');
  if (s.length === 0) return null;
  if (PRESENT_WORDS.test(s)) return 'present';
  const year = YEAR.exec(s);
  if (!year) return null;
  const y = Number(year[1]);
  if (y < MIN_YEAR) return null;
  // Numeric month next to the year: "01/2020", "2020-01", "03 2019", "2020/03".
  const numeric = /(?:^|[\s/\-])(0?[1-9]|1[0-2])\s*[/\-\s]\s*(?:19|20)\d\d\b/.exec(s) ?? /\b(?:19|20)\d\d\s*[/\-\s]\s*(0?[1-9]|1[0-2])(?=$|\D)/.exec(s);
  if (numeric && numeric[1]) return { year: y, month: Number(numeric[1]) };
  const words = s.match(/[\p{L}]+/gu) ?? [];
  for (const w of words) {
    const m = MONTH_STEMS.findIndex((stems) => stems.some((stem) => w.startsWith(stem)));
    if (m >= 0) return { year: y, month: m + 1 };
  }
  return { year: y, month: null };
}

/** Start and end strings → a closed range, resolved against `now`; null when either side is not a date. */
export function parseRange(start: string | null | undefined, end: string | null | undefined, now: Date): DateRange | null {
  const from = parseResumeDate(start);
  const to = parseResumeDate(end);
  if (!from || from === 'present') return null;
  if (!to) return null;
  const fromDate = { year: from.year, month: from.month ?? 1 };
  const toDate = to === 'present' ? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 } : { year: to.year, month: to.month ?? 12 };
  if (index(toDate) < index(fromDate)) return null;
  return { from: fromDate, to: toDate };
}

/** Months since the epoch of the calendar — the unit every comparison here is done in. */
function index(d: ParsedDate): number {
  return d.year * 12 + ((d.month ?? 1) - 1);
}

/**
 * Years covered by the ranges, overlaps merged — two parallel roles are one
 * span of time, not double experience. Inclusive of both end months, one
 * decimal.
 */
export function yearsCovered(ranges: DateRange[]): number {
  const spans = ranges
    .map((r) => ({ a: index(r.from), b: index(r.to) + 1 }))
    .sort((x, y) => x.a - y.a);
  let months = 0;
  let cursor = -Infinity;
  for (const s of spans) {
    const a = Math.max(s.a, cursor);
    if (s.b > a) months += s.b - a;
    cursor = Math.max(cursor, s.b);
  }
  return Math.round((months / 12) * 10) / 10;
}

/** Months between the latest end among the ranges and `now`; null with no ranges. */
export function monthsSinceLatest(ranges: DateRange[], now: Date): number | null {
  if (ranges.length === 0) return null;
  const latest = Math.max(...ranges.map((r) => index(r.to)));
  return Math.max(0, index({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }) - latest);
}

/** "Mar 2019 – Present" / "2020" — the range as the scorecard prints it. */
export function formatRange(r: DateRange, now: Date): string {
  const nowIdx = index({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const fmt = (d: ParsedDate) => (d.month ? `${MONTH_SHORT[d.month - 1]} ${d.year}` : String(d.year));
  return `${fmt(r.from)} – ${index(r.to) >= nowIdx ? 'present' : fmt(r.to)}`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
