import type { LocationHints, WorkplaceCode } from './location';

export interface NormalizedJob {
  companyId: number;
  externalId: string;
  title: string;
  url: string;
  location: string;
  description: string;
  postedAt: Date;
  /**
   * What the source said in structured fields (ISO codes, region codes, the
   * arrangement) — ADR 0031. Filled only where a feed has such fields; the
   * location parser reads the string for everything else.
   */
  locationHints?: LocationHints;
  /** The posting as the source sent it, when its licence asks for it to be shown whole (ADR 0034). */
  sourcePayload?: unknown;
  /** The source's own last-update stamp, when it has one. */
  sourceUpdatedAt?: Date | null;
}

export interface ClaudeClassification {
  fit_score: number;
  /** True when the role matches the active profile's location preferences. */
  location_match: boolean;
  /** The posting's own numbers; the currency and the period say what they mean. */
  salary_min: number | null;
  salary_max: number | null;
  /** ISO-4217; absent or null = USD (src/currency.ts). */
  salary_currency?: string | null;
  /** year | month | week | day | hour; absent or null = year. */
  salary_period?: string | null;
  tech_match: string[];
  red_flags: string[];
  summary: string;
}

export interface ClassifyInput {
  title: string;
  companyName: string;
  location: string;
  /** The columns the parser filled (ADR 0031) — the prompt's starting point for the place. */
  place?: { workplace: WorkplaceCode; countries: string[]; regions: string[] };
  description: string;
  postedAt: Date;
}

export interface AlertJob {
  title: string;
  companyName: string;
  location: string;
  /** ADR 0031 columns, so the line can show flags and the arrangement. */
  countries?: string[];
  workplace?: WorkplaceCode;
  url: string;
  fitScore: number;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
  techMatch: string[];
  redFlags: string[];
  summary: string;
  /** Company this posting is also listed at (F3 cross-listing annotation). */
  crossListedAt?: string | null;
  /** ADR 0028: the search that wanted this posting most. */
  matchedProfile?: string | null;
  /** Every search's verdict, best first ("Backend 87 · QA 41"). Null when
   *  only one search is running — a one-item list is noise, not context. */
  profileScores?: string | null;
  /** What a vendor's terms make the alert say ("Jobs by Adzuna — https://…", ADR 0034). */
  attribution?: string | null;
}
