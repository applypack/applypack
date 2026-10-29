import type { StoredFitFacts } from './fit-score';
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
  /**
   * Who hires, from an aggregator's own field (ADR 0056): a name, or null
   * when the feed did not say. Absent on a source that IS the employer — a
   * vendor board, a feed — so absent and null differ: the source's own name
   * is the key, or nobody is (employer.ts:hiringKey).
   */
  employer?: string | null;
  /** The file inside a folder source the row came from (ADR 0062): kept on the job, named on its page and in its alert. */
  sourceFile?: string;
  /**
   * A posting the user saved themselves (ADR 0062): treated as a paste, so no
   * search's base filter and no employer gate turns it away — they chose it.
   */
  handPicked?: boolean;
  /**
   * The model that read a saved page took it for something else than a job
   * posting (#451): stored Saved, unscored and flagged, never set aside.
   */
  notAPosting?: boolean;
  /** The ledger rows of the model call that read a saved posting before it had a row (#543): named on the job when it is stored. */
  readCalls?: number[];
  /**
   * The source gave no date this posting was published on, so `postedAt` is
   * the clock's or a file's (#379). It still orders and shows the posting; it
   * is no evidence that the posting is recent, and nothing is prepared on its
   * own for it (pack/trigger.ts) unless something else shows its age. Set by
   * the row mapper, and for every other source by
   * `fetchers/dates.ts:markClockDated` where its read ends.
   */
  undated?: boolean;
  /**
   * When the source was last read successfully before the read that brought
   * this posting (`Company.lastOkAt` before the walk moves it); absent on a
   * first read and where nothing was read before (#459). On a company's own
   * board it bounds an undated posting's age (pack/trigger.ts:ageCountsFrom).
   */
  previousRead?: Date;
}

export interface ClaudeClassification {
  /** Since ADR 0064 computed from `fit_facts` (fit-score.ts), never written by the model. */
  fit_score: number;
  /** What the reply said the posting shows for this search, kept on `JobScore.fitFacts`; absent on a verdict built without facts. */
  fit_facts?: StoredFitFacts;
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
  /** The stored posting: with the dashboard's address set, the message links to its page there (#487). */
  jobId?: number;
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
  /** ★ A company the user put on the watchlist (ADR 0036). The header then
   *  says "new posting" rather than "match": with `alertPolicy = all` the row
   *  may be below every threshold, and the alert must not claim otherwise. */
  watched?: boolean;
}
