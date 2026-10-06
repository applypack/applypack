import { t } from '../i18n/t';

/**
 * Pure formatter for the stale-applications digest. Lives in its own file
 * so it can be unit-tested without pulling in Prisma / Anthropic / pino.
 * The words are the catalog's, in the language of the run (ADR 0061); the
 * title, the company and the resume's name stay as they are.
 */

export interface StaleApplicationItem {
  title: string;
  companyName: string;
  url: string;
  appliedAt: Date;
  daysSince: number;
  recruiterContact: string | null;
  /** `appliedWithLabel` output — null for the applications that never recorded one. */
  appliedWith: string | null;
}

export function formatStaleMessage(items: StaleApplicationItem[]): string {
  if (items.length === 0) {
    return `_${t('stale.none')}_`;
  }
  const header = `*${t('stale.header', { n: items.length })}*`;
  const blocks = items.map((i) => {
    const applied = i.appliedWith
      ? t('stale.appliedWith', { days: i.daysSince, resume: i.appliedWith })
      : t('stale.applied', { days: i.daysSince });
    const contact = i.recruiterContact ? ` ${t('stale.lastContact', { contact: i.recruiterContact })}` : '';
    return `• *${i.title}* @ ${i.companyName} — ${applied}${contact}`;
  });
  return [header, ...blocks].join('\n');
}
