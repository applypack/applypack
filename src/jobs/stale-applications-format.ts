import { formatDateTime } from '../i18n/format';
import { t } from '../i18n/t';
import { dashboardLink } from '../notify/dashboard-link';
import type { MessageLine } from '../notify/lines';
import { safeHref } from '../web/format';
import { jobHref } from '../web/job-tabs';

/**
 * Pure formatter for the stale-applications reminder (#578). Lives in its own
 * file so it can be unit-tested without pulling in Prisma / Anthropic / pino.
 * The words are the catalog's, in the language of the run (ADR 0061); the
 * title, the company and the resume's name stay as they are. Plain lines:
 * each channel escapes them in its own markup (notifier.ts:sendStaleReminder).
 */

export interface StaleApplicationItem {
  jobId: number;
  title: string;
  companyName: string;
  url: string;
  appliedAt: Date;
  daysSince: number;
  /** `appliedWithLabel` output — null for the applications that never recorded one. */
  appliedWith: string | null;
}

/**
 * How many applications have waited longer than `days`, then one line per
 * application with the day it went out. Each line links to the job's page on
 * the dashboard when its address is set (#487), else to the posting itself.
 */
export function formatStaleMessage(
  items: readonly StaleApplicationItem[],
  days: number,
  { address, timeZone }: { address: string | null; timeZone: string },
): MessageLine[] {
  const lines = items.map((i): MessageLine => {
    const said = {
      title: i.title,
      company: i.companyName,
      date: formatDateTime(i.appliedAt, { dateStyle: 'medium', timeZone }),
      days: i.daysSince,
    };
    const text = i.appliedWith ? t('stale.lineWith', { ...said, resume: i.appliedWith }) : t('stale.line', said);
    return { text: `• ${text}`, link: dashboardLink(address, jobHref(i.jobId)) ?? safeHref(i.url) };
  });
  return [{ text: t('stale.header', { n: items.length, days }), link: null }, ...lines];
}
