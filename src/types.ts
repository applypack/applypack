export interface NormalizedJob {
  companyId: number;
  externalId: string;
  title: string;
  url: string;
  location: string;
  description: string;
  postedAt: Date;
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
}
