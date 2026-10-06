import { monthsSinceLatest, parseRange, yearsCovered, type DateRange } from '../screening/dates';
import type { WorkEntry } from './json-resume';
import type { KeywordMatcher } from './keyword-matcher';
import type { MatchKeyword } from './prompts';
import { structureFromText } from './structure-from-text';
import { t } from '../i18n/t';

/*
 * How long, and how lately, the resume shows each wanted term at work (TASKS
 * R8): the dated roles whose own lines name it, their spans merged the way the
 * employer side merges them (screening/dates.ts). "Kafka — 1.5 years, last
 * used four years ago" is what a screener reads off the roles in a glance, so
 * the candidate reads it first. Shown beside the keyword; the score does not
 * count it (ADR 0058) — a term used four years ago is still a term the
 * candidate has, and how much a posting minds is the posting's to say.
 * Pure: the text, the matcher and the clock arrive as arguments.
 */

export interface TermUsage {
  /** Years the roles that name it cover, overlaps merged, one decimal. */
  years: number;
  /** Months since the latest of those roles ended; 0 while one is current. */
  monthsSince: number;
}

/** The employer side's "within 36 months" rule (screening/rubric.ts): past it, a term reads as not recent. */
export const STALE_MONTHS = 36;

/** A role's own words: its title, company, summary and bullets, its stack line among them. */
function roleText(w: WorkEntry): string {
  return [w.position, w.name, w.summary, ...w.highlights, w.after].filter(Boolean).join('\n');
}

/** Usage per present term, keyed by the term as the table spells it; a term no dated role names has none. */
export function termUsage(
  keywords: Pick<MatchKeyword, 'term' | 'aliases' | 'status'>[],
  resumeText: string,
  matcher: Pick<KeywordMatcher, 'findTerm'>,
  now: Date,
): Map<string, TermUsage> {
  const usage = new Map<string, TermUsage>();
  const roles = structureFromText(resumeText)
    .work.map((w) => ({ text: roleText(w), range: parseRange(w.startDate, w.endDate, now) }))
    .filter((r): r is { text: string; range: DateRange } => r.range !== null);
  if (roles.length === 0) return usage;
  for (const k of keywords) {
    if (k.status !== 'present') continue;
    const ranges = roles.filter((r) => matcher.findTerm(r.text, k.term, k.aliases).length > 0).map((r) => r.range);
    const since = monthsSinceLatest(ranges, now);
    if (since !== null) usage.set(k.term, { years: yearsCovered(ranges), monthsSince: since });
  }
  return usage;
}

const MONTHS_IN_YEAR = 12;

/** "3.5 yrs at work · current", "1 yr at work · 4 yrs ago". */
export function usageLine(u: TermUsage): string {
  const { years, monthsSince } = u;
  if (monthsSince === 0) return t('resume.usage.current', { years });
  if (monthsSince < MONTHS_IN_YEAR) return t('resume.usage.monthsAgo', { years, months: monthsSince });
  return t('resume.usage.yearsAgo', { years, ago: Math.round(monthsSince / MONTHS_IN_YEAR) });
}
