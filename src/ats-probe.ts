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

  let url: string;
  switch (atsType) {
    case AtsType.GREENHOUSE:
      url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(trimmed)}/jobs`;
      break;
    case AtsType.LEVER:
      url = `https://api.lever.co/v0/postings/${encodeURIComponent(trimmed)}?mode=json&limit=1`;
      break;
    case AtsType.ASHBY:
      url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(trimmed)}`;
      break;
    default:
      return {
        ok: false,
        error: `No per-company probe available for ${atsType} (it's an aggregator feed).`,
      };
  }

  try {
    const resp = await fetchWithRetry(url, { timeoutMs: 8_000 });
    const data: unknown = await resp.json();
    const jobsCount = countJobs(data);
    return { ok: true, jobsCount };
  } catch (err) {
    if (err instanceof HttpError) {
      return {
        ok: false,
        error: `HTTP ${err.status} from ${atsType} — token "${trimmed}" likely invalid.`,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown probe error.',
    };
  }
}

function countJobs(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const jobs = obj.jobs;
    if (Array.isArray(jobs)) return jobs.length;
  }
  return 0;
}
