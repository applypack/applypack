/**
 * Pure formatter for the stale-applications digest. Lives in its own file
 * so it can be unit-tested without pulling in Prisma / Anthropic / pino.
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
    return '_No stale applications._';
  }
  const header = `*Stale applications — ${items.length} need a follow-up*`;
  const blocks = items.map(
    (i) =>
      `• *${i.title}* @ ${i.companyName} — applied ${i.daysSince}d ago` +
      (i.appliedWith ? ` with ${i.appliedWith}` : '') +
      (i.recruiterContact ? ` (last contact: ${i.recruiterContact})` : ''),
  );
  return [header, ...blocks].join('\n');
}
