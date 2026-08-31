/**
 * Pure source-health logic (ADR 0019). No I/O — the only import is the
 * HttpError class, so this file unit-tests without Prisma or the network.
 *
 * The error shapes below were measured against the live vendors on
 * 2026-08-30, not assumed: `fetchWithRetry` rewrites an aborted request
 * into a plain Error (so `err.name` is useless for timeouts), a dead
 * BambooHR slug arrives as a redirect refusal rather than a 404, and
 * Cloudflare answers 429 for a board that is perfectly alive.
 */
import { HttpError } from '../http';

export const FETCH_STATUSES = [
  'ok',
  'empty',
  'slug_gone',
  'auth',
  'rate_limit',
  'server',
  'network',
  'bad_payload',
  'unknown',
] as const;

export type FetchStatus = (typeof FETCH_STATUSES)[number];

/** Statuses that clear the streak. Everything else increments it. */
const HEALTHY: ReadonlySet<FetchStatus> = new Set<FetchStatus>(['ok', 'empty']);

/** Three hourly ticks — see ADR 0019 for why the base rate allows this. */
export const QUIET_STREAK = 3;

/**
 * Days without a single posting before a reachable source counts as silent.
 * Unmeasured on purpose: `lastOkAt` has no history yet, so this is the
 * conservative end of the guess and is due a re-measure (ADR 0019).
 */
export const SILENT_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Transport-level failure codes Node surfaces on `TypeError.cause`. */
const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

function causeOf(err: unknown): { code?: string; message?: string } {
  const cause = (err as { cause?: unknown })?.cause;
  if (cause === null || typeof cause !== 'object') return {};
  const c = cause as { code?: unknown; message?: unknown };
  return {
    code: typeof c.code === 'string' ? c.code : undefined,
    message: typeof c.message === 'string' ? c.message : undefined,
  };
}

/**
 * A thrown value from `fetchOne` → a status. Never returns `ok` or `empty`:
 * those describe a successful fetch and come from the row count instead.
 */
export function classifyFetchError(err: unknown): FetchStatus {
  if (err instanceof HttpError) {
    if (err.status === 404 || err.status === 410) return 'slug_gone';
    if (err.status === 401 || err.status === 403) return 'auth';
    if (err.status === 429) return 'rate_limit';
    if (err.status >= 500) return 'server';
    return 'unknown';
  }

  const name = (err as { name?: unknown })?.name;
  // A 200 carrying HTML instead of JSON dies in resp.json().
  if (name === 'SyntaxError' || name === 'ZodError') return 'bad_payload';

  const { code, message: causeMessage } = causeOf(err);
  // `redirect: 'error'` refusing a vendor's 302-to-marketing-page. Measured
  // on BambooHR, where that — not a 404 — is how a dead slug presents.
  if (causeMessage !== undefined && /unexpected redirect/i.test(causeMessage)) {
    return 'slug_gone';
  }
  if (code !== undefined && NETWORK_CODES.has(code)) return 'network';

  const message = (err as { message?: unknown })?.message;
  if (typeof message === 'string') {
    // fetchWithRetry's own rewrite of an AbortError.
    if (/timed out after \d+ms/.test(message)) return 'network';
    if (/schema invalid/i.test(message)) return 'bad_payload';
    // Any other transport failure undici reports as a bare "fetch failed".
    if (name === 'TypeError' && /fetch failed/i.test(message)) return 'network';
  }
  if (name === 'AbortError') return 'network';

  return 'unknown';
}

/** A successful fetch → a status, from the RAW pre-filter row count. */
export function classifyFetchCount(count: number): FetchStatus {
  return count > 0 ? 'ok' : 'empty';
}

/**
 * The streak, inverted on purpose: `ok` and `empty` reset, EVERYTHING else
 * increments — including `unknown`. A status added later cannot fall out of
 * the streak by omission; the worst it can do is be counted.
 */
export function nextStreak(status: FetchStatus, current: number): number {
  if (HEALTHY.has(status)) return 0;
  return Math.max(0, current) + 1;
}

export interface SourceHealth {
  lastFetchStatus: string | null;
  consecutiveFailures: number;
  lastOkAt: Date | null;
  createdAt: Date;
}

/** Loud breakage: the source is throwing and has been for QUIET_STREAK ticks. */
export function isFailing(h: SourceHealth): boolean {
  return h.consecutiveFailures >= QUIET_STREAK;
}

/**
 * Quiet breakage: reachable, but it has produced no posting for SILENT_DAYS.
 * This is the only signal that catches a SmartRecruiters slug that will
 * never resolve, or a vendor that silently started answering `[]`.
 * A source we have never fetched is not silent — it is unknown.
 */
export function isSilent(h: SourceHealth, now: Date): boolean {
  if (h.lastFetchStatus === null || isFailing(h)) return false;
  const since = h.lastOkAt ?? h.createdAt;
  return now.getTime() - since.getTime() >= SILENT_DAYS * DAY_MS;
}

export type QuietReason = 'failing' | 'silent';

export function quietReason(h: SourceHealth, now: Date): QuietReason | null {
  if (isFailing(h)) return 'failing';
  if (isSilent(h, now)) return 'silent';
  return null;
}

export type HealthTone = 'good' | 'idle' | 'bad' | 'warn' | 'none';

/** Display label + tone for the `/companies` status dot. */
export function describeStatus(status: string | null): {
  label: string;
  tone: HealthTone;
} {
  switch (status) {
    case 'ok':
      return { label: 'OK', tone: 'good' };
    case 'empty':
      return { label: 'No postings', tone: 'idle' };
    case 'slug_gone':
      return { label: 'Slug not found', tone: 'bad' };
    case 'auth':
      return { label: 'Board is gated', tone: 'bad' };
    case 'bad_payload':
      return { label: 'Unreadable payload', tone: 'bad' };
    case 'rate_limit':
      return { label: 'Rate-limited', tone: 'warn' };
    case 'server':
      return { label: 'Vendor error', tone: 'warn' };
    case 'network':
      return { label: 'Unreachable', tone: 'warn' };
    case 'unknown':
      return { label: 'Unknown error', tone: 'warn' };
    default:
      return { label: 'Not fetched yet', tone: 'none' };
  }
}
