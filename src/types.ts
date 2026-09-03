import type { LocationHints } from './location';

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
}

export interface ClaudeClassification {
  fit_score: number;
  /** True when the role matches the active profile's location preferences. */
  location_match: boolean;
  salary_min_usd: number | null;
  salary_max_usd: number | null;
  tech_match: string[];
  red_flags: string[];
  summary: string;
}

export interface ClassifyInput {
  title: string;
  companyName: string;
  location: string;
  description: string;
  postedAt: Date;
}

export interface AlertJob {
  title: string;
  companyName: string;
  location: string;
  url: string;
  fitScore: number;
  salaryMin: number | null;
  salaryMax: number | null;
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
}
