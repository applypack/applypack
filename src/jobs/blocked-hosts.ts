/*
 * The hosts ADR 0005 names: never requested, not even one page at a time.
 * Pure — tested in blocked-hosts.test.ts — so a module that only has to know
 * "is this link on one of them" does not import the fetch path.
 */

export const BLOCKED_POSTING_HOSTS: readonly string[] = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'workday.com',
  'myworkdayjobs.com',
  'wellfound.com',
  'dice.com',
  // The same sites under another name: LinkedIn's short links, Wellfound's old
  // domain, Workday's second host.
  'lnkd.in',
  'angel.co',
  'myworkdaysite.com',
];

/** Named sites that also answer under a country's domain: indeed.co.uk, glassdoor.de, linkedin.cn. */
const BLOCKED_BRANDS: readonly string[] = ['linkedin', 'indeed', 'glassdoor'];

/** What may follow a brand's label for the name to be that brand's own: a top-level domain, or a country's second level (co.uk, com.au). */
const PUBLIC_SUFFIX = /^(?:[a-z0-9-]{2,}|(?:co|com|net|org|ac|ne|or)\.[a-z]{2})$/;

/** True for a blocked host, any subdomain of one, and a named site under any country's domain. */
export function isBlockedPostingHost(hostname: string): boolean {
  // A trailing dot is the same name to the resolver and a different string to a check.
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (BLOCKED_POSTING_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) return true;
  const labels = host.split('.');
  return labels.some((label, i) => BLOCKED_BRANDS.includes(label) && PUBLIC_SUFFIX.test(labels.slice(i + 1).join('.')));
}
