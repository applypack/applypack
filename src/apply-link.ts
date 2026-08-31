/**
 * Apply-link checks: cheap, ingest-time annotation of postings you cannot
 * actually apply through. Pure — no DB, no HTTP, no config.
 *
 * Every rule here is true by definition rather than tuned to a threshold,
 * which is deliberate: our corpus contains no scam postings to calibrate
 * against (ADR 0023 records the measurement). A shortener genuinely hides
 * its destination and a video page genuinely cannot take an application,
 * whether or not either has appeared yet.
 *
 * Flags only — nothing here rejects, hides or rewrites a row. The output
 * joins the model's own tags in `Job.redFlags`.
 */

/** Kebab-case to match the existing red-flag vocabulary ("stack-mismatch", …). */
export const APPLY_URL_MISSING = 'apply-url-missing';
export const APPLY_URL_UNUSABLE = 'apply-url-unusable';
export const APPLY_URL_SHORTENED = 'apply-url-shortened';
export const APPLY_URL_NOT_AN_APPLICATION = 'apply-url-not-an-application';

/** Every tag this module can produce, for the UI legend and the guard test. */
export const APPLY_LINK_FLAGS = [
  APPLY_URL_MISSING,
  APPLY_URL_UNUSABLE,
  APPLY_URL_SHORTENED,
  APPLY_URL_NOT_AN_APPLICATION,
] as const;

/**
 * Destination-hiding redirectors only. `forms.gle` is deliberately absent:
 * a Google Form announces exactly what it is, and the single occurrence in
 * our corpus is a small company on HN collecting applications legitimately.
 * A one-row category is not a rule we can calibrate (ADR 0023).
 */
const SHORTENER_HOSTS = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'buff.ly',
  'rebrand.ly',
  'is.gd',
  'cutt.ly',
  'shorturl.at',
  'lnkd.in',
  'rb.gy',
  'tiny.cc',
];

/**
 * Hosts that cannot serve a job application, whatever the path. A posting
 * whose apply link lands here leaves you with nothing to submit — measured
 * twice in our corpus, both from HN comments (a YouTube video and a
 * LinkedIn company page).
 */
const NOT_AN_APPLICATION_HOSTS = [
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'tiktok.com',
  't.me',
  'wa.me',
  'discord.gg',
];

export interface ApplyLink {
  url: string;
  /**
   * True for rows the user pasted by hand (`AtsType.MANUAL`). A pasted job
   * legitimately has no URL — that is how `/jobs/new` stores it — so the
   * missing-URL flag would fire on the user's own input and nothing else.
   */
  pasted: boolean;
}

/**
 * Host of an http(s) URL, lowercased and without `www.`; null when the URL
 * is unusable as an apply link (unparseable, or a scheme a browser cannot
 * open a posting with).
 */
function applyHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return host.length > 0 ? host : null;
}

/**
 * Host match on a domain boundary, never a substring: `mylinkedin.com` is
 * not LinkedIn and `notbit.ly.example.com` is not a shortener.
 */
function onDomain(host: string, domains: readonly string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Tags for one posting's apply link. Empty array when the link is fine,
 * which is the overwhelmingly common case.
 *
 * The company name is deliberately not an input. The plan proposed a
 * company↔domain mismatch rule; measured on our corpus it produced either
 * nothing or 37% false positives, and its non-Latin-name exemption would
 * have protected zero rows. Leaving the name out makes the exemption
 * structural — a company called "Ромашка" or "株式会社テスト" is treated
 * exactly like any other, because its name never reaches this code.
 */
export function checkApplyLink(link: ApplyLink): string[] {
  const url = link.url.trim();
  if (url.length === 0) return link.pasted ? [] : [APPLY_URL_MISSING];

  const host = applyHost(url);
  if (host === null) return [APPLY_URL_UNUSABLE];

  const flags: string[] = [];
  if (onDomain(host, SHORTENER_HOSTS)) flags.push(APPLY_URL_SHORTENED);
  if (onDomain(host, NOT_AN_APPLICATION_HOSTS)) {
    flags.push(APPLY_URL_NOT_AN_APPLICATION);
  }
  return flags;
}

/**
 * The model's red flags plus this module's, de-duplicated and with the
 * model's order preserved. One helper because three call sites persist
 * `redFlags` — ingest, re-classify and classify-one — and a merge done in
 * only two of them silently drops the tags on the next re-classification.
 */
export function withApplyLinkFlags(
  modelFlags: readonly string[],
  link: ApplyLink,
): string[] {
  const merged = [...modelFlags];
  for (const flag of checkApplyLink(link)) {
    if (!merged.includes(flag)) merged.push(flag);
  }
  return merged;
}
