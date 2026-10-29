/**
 * How the tick paces itself against the boards — the order it walks them in
 * and the gap it leaves between requests (docs/scale-plan.md §3). Pure.
 *
 * `id ASC` is the same order on every install, because the ids come from a
 * `seed.ts` that is byte-identical everywhere: install #1 and install #500
 * both ask the first seeded Greenhouse board first, and — with the polite
 * one-second delay between sources — the second one a second later, in
 * lockstep. Shuffling the walk costs nothing and turns a synchronised burst
 * into ordinary background noise.
 *
 * The order of the walk only: anything that has to be stable (which Adzuna
 * rows fall inside the monthly limit, ADR 0034) is decided from the
 * id-ordered list before this runs.
 */
import { AtsType } from '@prisma/client';
import type { FetchStatus } from './source-health';

/** Fisher–Yates over a copy. Seeded, so the shuffle itself is testable. */
export function shuffleSources<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** A fresh seed for one tick. */
export function tickSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

/** mulberry32 — small, well-spread, and not a security boundary. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/** The gap after a source that sent us a whole feed. */
export const POLITE_DELAY_MS = 1_000;

/**
 * The gap after a source that answered "unchanged". A 304 carries no body
 * and costs the board a freshness check, so backing off for a full second —
 * the same as after a megabyte of RSS — pays for something we did not spend.
 * A quarter of a second still caps us at four revalidations a second, and
 * only if the shuffle happens to put several unchanged sources in a row.
 *
 * It is a shorter pause, never none: a 304 is still a request.
 */
export const UNCHANGED_DELAY_MS = 250;

/**
 * Boards that publish their own pacing. We honour it whatever the answer
 * cost us — a vendor saying "one second" did not add "unless it's cheap".
 *
 * Read 2026-09-04: `api.lever.co/robots.txt` is `User-agent: *` / `Allow: /`
 * / `Crawl-delay: 1`, so it addresses every automated client on that host.
 * No other conditional-capable source declares one (Greenhouse, Ashby,
 * SmartRecruiters, Personio, Teamtailor, We Work Remotely, Golang Projects,
 * Remotive, DevITjobs: nothing in robots.txt).
 */
const DECLARED_CRAWL_DELAY_MS: Partial<Record<AtsType, number>> = {
  [AtsType.LEVER]: 1_000,
};

/**
 * Feeds that ask to be read less often than the hourly heartbeat. Remotive
 * says so in every answer (read 2026-10-29): "we advise max. 4 times a
 * day", over a public feed of a dozen postings held back 24 hours (#661).
 */
const DECLARED_POLL_INTERVAL_MS: Partial<Record<AtsType, number>> = {
  [AtsType.REMOTIVE]: 6 * 60 * 60 * 1000,
};

/** The shortest gap between two scheduled reads of this source; 0 = the row's own interval decides. */
export function pollIntervalFloorMs(atsType: AtsType): number {
  return DECLARED_POLL_INTERVAL_MS[atsType] ?? 0;
}

/**
 * How long to wait after this source before the next request goes out: the
 * vendor's declared pacing, and a site's own `Crawl-delay` read when its row
 * was added — any host a user adds can ask for one (ADR 0035's trigger).
 */
export function politeDelayMs(status: FetchStatus, atsType: AtsType, rowCrawlDelayMs: number | null = null): number {
  const base = status === 'not_modified' ? UNCHANGED_DELAY_MS : POLITE_DELAY_MS;
  return Math.max(base, DECLARED_CRAWL_DELAY_MS[atsType] ?? 0, rowCrawlDelayMs ?? 0);
}
