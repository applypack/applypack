import { AtsType } from '@prisma/client';
import { fetchWithRetry, HttpError } from './http';

export interface ProbeResult {
  ok: boolean;
  jobsCount?: number;
  error?: string;
}

/**
 * Lightweight liveness check: hit the public ATS endpoint for a given
 * (atsType, atsToken) pair and report whether it returns 200 + a non-empty
 * JSON shape. Used by the manual add-company form so users get instant
 * "no, that token is wrong" feedback.
 *
 * Aggregator types (LARAJOBS_RSS, REMOTEOK, REMOTIVE, ARBEITNOW, HN_HIRING)
 * are synthetic single-source feeds — there is no per-company endpoint to
 * probe, so we return a clear "no probe available" error.
 */
export async function probeAts(
  atsType: AtsType,
  atsToken: string,
): Promise<ProbeResult> {
  const trimmed = atsToken.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Empty atsToken.' };
  }

  try {
    let resp;
    switch (atsType) {
      case AtsType.GREENHOUSE:
        resp = await fetchWithRetry(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(trimmed)}/jobs`,
          { timeoutMs: 8_000 },
        );
        break;
      case AtsType.LEVER:
        resp = await fetchWithRetry(
          `https://api.lever.co/v0/postings/${encodeURIComponent(trimmed)}?mode=json&limit=1`,
          { timeoutMs: 8_000 },
        );
        break;
      case AtsType.ASHBY:
        resp = await fetchWithRetry(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(trimmed)}`,
          { timeoutMs: 8_000 },
        );
        break;
      case AtsType.WORKABLE:
        resp = await fetchWithRetry(
          `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(trimmed)}/jobs`,
          {
            timeoutMs: 8_000,
            init: {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: '',
                workplace: [],
                department: [],
              }),
            },
          },
        );
        break;
      case AtsType.RECRUITEE:
        resp = await fetchWithRetry(
          `https://${encodeURIComponent(trimmed)}.recruitee.com/api/offers/`,
          { timeoutMs: 8_000 },
        );
        break;
      case AtsType.BREEZY:
        resp = await fetchWithRetry(
          `https://${encodeURIComponent(trimmed)}.breezy.hr/json`,
          { timeoutMs: 8_000 },
        );
        break;
      case AtsType.RIPPLING:
        resp = await fetchWithRetry(
          `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(trimmed)}/jobs`,
          { timeoutMs: 8_000 },
        );
        break;
      case AtsType.PINPOINT:
        resp = await fetchWithRetry(
          `https://${encodeURIComponent(trimmed)}.pinpointhq.com/postings.json`,
          { timeoutMs: 8_000 },
        );
        break;
      case AtsType.BAMBOOHR:
        // An unknown slug 302s to the marketing site — fail instead.
        resp = await fetchWithRetry(
          `https://${encodeURIComponent(trimmed)}.bamboohr.com/careers/list`,
          { timeoutMs: 8_000, init: { redirect: 'error' } },
        );
        break;
      case AtsType.SMARTRECRUITERS:
        resp = await fetchWithRetry(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(trimmed)}/postings?limit=1`,
          { timeoutMs: 8_000 },
        );
        break;
      default:
        return {
          ok: false,
          error: `No per-company probe available for ${atsType} (it's an aggregator feed).`,
        };
    }
    const data: unknown = await resp.json();
    const jobsCount = countJobs(data);
    return { ok: true, jobsCount };
  } catch (err) {
    if (err instanceof HttpError) {
      return { ok: false, error: describeHttpFailure(err.status, atsType, trimmed) };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown probe error.',
    };
  }
}

/**
 * A failed probe is only evidence about the token when the vendor actually
 * looked it up. Rate limiting and outages say nothing about the slug, and
 * reporting them as "invalid token" sends the user chasing the wrong thing.
 */
function describeHttpFailure(
  status: number,
  atsType: AtsType,
  atsToken: string,
): string {
  if (status === 429) {
    return `${atsType} is rate-limiting us (HTTP 429) — try again in a minute.`;
  }
  if (status >= 500) {
    return `${atsType} returned HTTP ${status} — the vendor is having trouble.`;
  }
  return `HTTP ${status} from ${atsType} — token "${atsToken}" likely invalid.`;
}

function countJobs(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.jobs)) return obj.jobs.length;
    // Recruitee
    if (Array.isArray(obj.offers)) return obj.offers.length;
    // BambooHR / Pinpoint
    if (Array.isArray(obj.result)) return obj.result.length;
    if (Array.isArray(obj.data)) return obj.data.length;
    // Workable
    if (Array.isArray(obj.results)) return obj.results.length;
    if (typeof obj.total === 'number') return obj.total as number;
    // SmartRecruiters
    if (Array.isArray(obj.content)) return obj.content.length;
    if (typeof obj.totalFound === 'number') return obj.totalFound as number;
  }
  return 0;
}
