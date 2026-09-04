/**
 * Conditional requests: ask a board for its feed only when the feed changed
 * (docs/scale-plan.md §4).
 *
 * Measured 2026-09-04 over two live ticks, not assumed: Greenhouse, Lever,
 * Ashby, DevITjobs, Pinpoint, Personio, Teamtailor, Golang Projects, Breezy
 * and SmartRecruiters answer 304 to `If-None-Match`; Remotive answers 304 to
 * `If-Modified-Since`; We Work Remotely is wired but rarely fires, because
 * its ETag hashes a body that is not byte-stable between requests.
 * Others send no validator or ignore the one they send,
 * and for those this module is a no-op — `conditionalHeaders` returns nothing
 * until a vendor has actually handed us a validator, so a source that turns
 * them on later is picked up for free and there is no allow-list to keep in
 * sync with a measurement that will go stale.
 *
 * Three rules make this safe rather than merely cheap:
 *
 * 1. **A 304 returns no jobs.** Those rows are already in the database;
 *    replaying them would run the whole filter → dedupe → upsert path every
 *    hour to reach the state we are already in. Nothing of the response is
 *    kept either, which is what Remotive's `no-store` asks of us.
 * 2. **A 304 repeats the previous verdict, not a blanket "healthy".** The
 *    remembered row count is what `advancesLastOk` reads: a board that
 *    answers 304 over an EMPTY body (measured on Breezy) must still age into
 *    "silent", which is the whole point of ADR 0019 and gotcha 13.
 * 3. **A validator is only committed once its jobs are stored.** A fetcher
 *    writes to the staged map; `commitConditionalCache()` promotes it, and
 *    `runFetchJob` calls that only when `tickStoredEverything()` agrees.
 *    Pausing mid-tick discards everything fetched so far, and a
 *    classification that never returned a verdict drops its posting —
 *    committing after either would answer 304 next tick and leave those
 *    postings unseen until the feed happened to change again.
 *
 * The cache is per-process and dies with it: a restart costs one full read
 * per source. That is the price of keeping it out of the schema, and at an
 * hourly tick it is a rounding error.
 */

interface Entry {
  /** The URL the validators came from — a source whose URL follows the searches must not reuse them. */
  url: string;
  etag: string | null;
  lastModified: string | null;
  /** Rows the last full response carried. */
  count: number;
}

/** What the next request may send. */
const live = new Map<number, Entry>();
/** What this tick learned, promoted only once its jobs are stored. */
const staged = new Map<number, Entry>();

/**
 * Validators for this company's next request, or `{}` when we have nothing
 * to revalidate against.
 */
export function conditionalHeaders(companyId: number, url: string): Record<string, string> {
  const entry = live.get(companyId);
  if (!entry || entry.url !== url) return {};
  const headers: Record<string, string> = {};
  if (entry.etag) headers['If-None-Match'] = entry.etag;
  if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  // Node's fetch appends `Cache-Control: no-cache` to any request carrying a
  // validator (the spec flips the cache mode to "no-store", which appends it
  // unless we set our own). Express reads that request directive literally
  // and refuses to answer 304 — measured 2026-09-04: Lever and
  // SmartRecruiters returned an IDENTICAL ETag and a full body until this
  // line was added, while curl got a 304 from the same URL. `max-age=0` says
  // what we actually mean: a stored copy is fine once revalidated.
  if (Object.keys(headers).length > 0) headers['Cache-Control'] = 'max-age=0';
  return headers;
}

/**
 * Records what a full (200) response carried. Call it after parsing, with
 * the row count — a response that failed to parse must not be remembered.
 */
export function rememberResponse(
  companyId: number,
  url: string,
  resp: { headers: { get(name: string): string | null } },
  count: number,
): void {
  const etag = resp.headers.get('etag');
  const lastModified = resp.headers.get('last-modified');
  if (etag === null && lastModified === null) return;
  staged.set(companyId, { url, etag, lastModified, count });
}

/** Rows the last full response carried, or null if we have never had one. */
export function cachedCount(companyId: number): number | null {
  return live.get(companyId)?.count ?? null;
}

/** Start of a tick: anything staged by a tick that never committed is dropped. */
export function beginConditionalTick(): void {
  staged.clear();
}

/**
 * Whether this tick may promote what it staged: only if it stored everything
 * it fetched. Every counter here marks a posting that was fetched and then
 * dropped — the pass aborted on a pause, no usable search existed, or the
 * model never produced a verdict. Committing after any of those would answer
 * 304 next tick over a posting nobody stored, and it would stay unseen until
 * the feed happened to change. One wasted full read is the cheaper mistake.
 *
 * A write failure needs no counter: `persistJob` rethrows everything except
 * P2002 (already stored), so a failing insert never reaches the commit.
 */
export function tickStoredEverything(stats: {
  abortedMidRun: number;
  skippedBlankProfile: number;
  classifyFailed: number;
}): boolean {
  return stats.abortedMidRun === 0 && stats.skippedBlankProfile === 0 && stats.classifyFailed === 0;
}

/** The jobs are stored — the validators they came with may now be sent. */
export function commitConditionalCache(): void {
  for (const [companyId, entry] of staged) live.set(companyId, entry);
  staged.clear();
}

/** Tests only. */
export function resetConditionalCache(): void {
  live.clear();
  staged.clear();
}
