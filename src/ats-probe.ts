import { AtsType } from '@prisma/client';
import { fetchWithRetry, HttpError } from './http';
import { douFeedUrl } from './fetchers/dou';
import { djinniFeedUrl } from './fetchers/djinni';
import { jobTechProbeUrl, parseJobTechTotal } from './fetchers/jobtech';
import { isPersonioFeed, parsePersonioXml, personioFeedUrl, personioSlug } from './fetchers/personio';
import { teamtailorFeedUrl, teamtailorHost } from './fetchers/teamtailor';
import { adzunaCount, adzunaMarket, adzunaSearchUrl, fetchAdzunaJson } from './fetchers/adzuna';
import { resolveSourceKeys, type SourceKeys } from './source-keys';

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
  opts: { keys?: SourceKeys } = {},
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
      case AtsType.DOU: {
        // The token is a feed query, not a slug: an unknown category answers
        // an EMPTY channel (verified 2026-09-03), so "no items" is the failure.
        const feed = await fetchWithRetry(douFeedUrl(trimmed), { timeoutMs: 8_000 });
        const items = ((await feed.text()).match(/<item>/g) ?? []).length;
        return items > 0
          ? { ok: true, jobsCount: items }
          : { ok: false, error: 'DOU answered no vacancies for this query — check the category spelling.' };
      }
      case AtsType.DJINNI: {
        // An unknown primary_keyword answers the whole bare feed (verified
        // 2026-09-03): the keyword must appear among the items' categories.
        const feed = await fetchWithRetry(djinniFeedUrl(trimmed), { timeoutMs: 8_000 });
        const xml = await feed.text();
        const keyword = new URLSearchParams(trimmed.replace(/^\?/, '')).get('primary_keyword');
        const itemXml = xml.slice(xml.indexOf('<item>'));
        const items = (itemXml.match(/<item>/g) ?? []).length;
        const matching = keyword
          ? (itemXml.match(/<category>([^<]*)<\/category>/g) ?? []).filter((c) => c.toLowerCase() === `<category>${keyword.toLowerCase()}</category>`).length
          : items;
        return matching > 0
          ? { ok: true, jobsCount: matching }
          : { ok: false, error: keyword ? `Djinni knows no primary_keyword "${keyword}" (or it has no vacancies right now).` : 'Djinni answered no vacancies for this filter.' };
      }
      case AtsType.PERSONIO: {
        // An unknown slug is a 307 to personio.com (verified 2026-09-03);
        // the fetch refuses redirects, so it surfaces here as a thrown error.
        let slug: string;
        try {
          slug = personioSlug(trimmed);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Invalid Personio token.' };
        }
        let xml: string;
        try {
          const feed = await fetchWithRetry(personioFeedUrl(slug), { timeoutMs: 8_000, init: { redirect: 'error' } });
          xml = await feed.text();
        } catch {
          return { ok: false, error: `Personio has no public feed for "${slug}" — the host redirects to personio.com.` };
        }
        if (!isPersonioFeed(xml)) return { ok: false, error: `"${slug}" answered something other than a Personio job feed.` };
        return { ok: true, jobsCount: parsePersonioXml(xml).length };
      }
      case AtsType.TEAMTAILOR: {
        // An unknown slug is a plain 404 (verified 2026-09-03); a custom
        // career domain is the user's own token and must be a public host.
        let host: string;
        try {
          host = teamtailorHost(trimmed);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Invalid Teamtailor token.' };
        }
        const feed = await fetchWithRetry(teamtailorFeedUrl(host), { timeoutMs: 8_000 });
        const xml = await feed.text();
        if (!/<rss[\s>]/i.test(xml)) return { ok: false, error: `"${host}" answered something other than a Teamtailor job feed.` };
        return { ok: true, jobsCount: (xml.match(/<item>/g) ?? []).length };
      }
      case AtsType.ADZUNA: {
        // One call with the user's own keys (ADR 0034); without them the
        // answer is the Sources tab, not a request.
        let code: string;
        try {
          code = adzunaMarket(trimmed).code;
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Not an Adzuna market.' };
        }
        const creds = resolveSourceKeys('ADZUNA', opts.keys ?? {});
        if (!creds) return { ok: false, error: 'Adzuna needs your app_id and app_key — paste them on Settings → Sources first.' };
        const raw = await fetchAdzunaJson(adzunaSearchUrl(code, creds as { app_id: string; app_key: string }, 1), creds);
        const count = adzunaCount(raw);
        return count === null
          ? { ok: false, error: 'Adzuna answered something other than a search result — check the keys.' }
          : { ok: true, jobsCount: count };
      }
      case AtsType.JOBTECH: {
        // An unknown taxonomy code or a hopeless query answers 200 with
        // total 0 (verified 2026-09-03), so the count is the check.
        const answer = await fetchWithRetry(jobTechProbeUrl(trimmed), { timeoutMs: 8_000 });
        const total = parseJobTechTotal(await answer.json());
        return total > 0
          ? { ok: true, jobsCount: total }
          : { ok: false, error: 'JobTech answered no ads for this filter — check the taxonomy codes or the query.' };
      }
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
