/**
 * The textarea on "Add companies" (TASKS §17 stage A). Pure.
 *
 * One company per line. A name is optional and, when given, comes first —
 * `Acme — https://acme.com/careers`, `Acme, https://…`, `Acme | https://…`,
 * or a tab. Everything else is read as a bare URL, which is what a pasted
 * list of links is. A `.txt` / `.csv` upload is the same text.
 */

/** How many lines one paste may carry. Beyond this the resolve run is long
 *  enough that the user should split it, and the request budget says so. */
export const MAX_LINES = 50;

export interface CompanyInput {
  /** What the user called it, or null to take the name from the page. */
  name: string | null;
  url: string;
}

/** A separator only counts when a URL follows it, so `https://a.com/a,b` survives. */
const SEPARATOR = /\s*(?:—|–|\||\t|,|\s-\s)\s*(?=https?:\/\/|www\.)/;

export interface ParsedInput {
  rows: CompanyInput[];
  /** Lines that carried no URL at all, kept so the screen can say which. */
  rejected: string[];
  /** True when MAX_LINES cut the list short. */
  truncated: boolean;
}

export function parseCompanyLines(text: string): ParsedInput {
  const rows: CompanyInput[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (rows.length >= MAX_LINES) {
      truncated = true;
      break;
    }
    const parts = line.split(SEPARATOR);
    const url = normaliseUrl(parts.length > 1 ? (parts[parts.length - 1] as string) : line);
    if (url === null) {
      rejected.push(line.slice(0, 120));
      continue;
    }
    // Two spellings of one host are one company; the first name given wins.
    const key = dedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const name = parts.length > 1 ? parts.slice(0, -1).join(' ').trim() : '';
    rows.push({ name: name.length > 0 ? name.slice(0, 100) : null, url });
  }
  return { rows, rejected, truncated };
}

/** `www.acme.com/careers` → `https://www.acme.com/careers`; null when it is not a URL. */
export function normaliseUrl(raw: string): string | null {
  const text = raw.trim().replace(/[.,;]+$/, '');
  if (text.length === 0) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // A hostname with no dot is a typo, not a site — `careers` should not
  // become `https://careers/`.
  if (!url.hostname.includes('.')) return null;
  return url.toString();
}

/** Host + path, so `acme.com/careers` and `acme.com/careers/` are one row. */
function dedupeKey(url: string): string {
  const u = new URL(url);
  return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * A readable fallback name from the hostname. Only a suggestion — the preview
 * shows it in an editable field, which is why there is no cleverer guess here
 * (a page `<title>` is "Careers, Internships, and Jobs at Shopify | Shopify
 * Careers - Shopify" as often as it is the company's name).
 *
 * Labels that only say "this is the careers site" are skipped, so
 * `careers.datadoghq.com` suggests Datadoghq rather than Careers.
 */
const GENERIC_LABELS = new Set(['www', 'careers', 'career', 'jobs', 'job', 'apply', 'boards', 'job-boards', 'work', 'hiring']);

export function nameFromUrl(url: string): string {
  const labels = new URL(url).hostname.toLowerCase().split('.');
  const label = labels.find((l) => !GENERIC_LABELS.has(l)) ?? labels[0] ?? '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}
