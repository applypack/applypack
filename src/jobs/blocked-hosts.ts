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
];

/** True for a blocked host and any subdomain of one. */
export function isBlockedPostingHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return BLOCKED_POSTING_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));
}
