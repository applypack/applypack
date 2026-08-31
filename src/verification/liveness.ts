import { z } from 'zod';
import { DEFAULT_USER_AGENT, stripHtml } from '../http';

/**
 * F1 liveness ladder (ADR 0016): free checks before the AI verify.
 * Rung 1 asks the ATS vendor's public posting API on a fixed host;
 * rung 2 fetches the stored posting URL and classifies the page.
 * The asymmetry doctrine governs every rule: a false `expired` hides a
 * live job forever, a false `uncertain` costs one re-check — so every
 * ambiguity resolves to `uncertain`, never `expired`.
 */

export type Liveness = 'active' | 'expired' | 'uncertain';

export type LivenessCode =
  | 'api_ok'
  | 'api_gone'
  | 'api_delisted'
  | 'api_ambiguous'
  | 'http_gone'
  | 'bot_challenge'
  | 'access_blocked'
  | 'server_error'
  | 'redirected_off_posting'
  | 'closed_banner'
  | 'insufficient_content'
  | 'page_ok'
  | 'unfetchable_url'
  | 'network_error'
  | 'conflicting_signals';

export interface LivenessVerdict {
  liveness: Liveness;
  code: LivenessCode;
}

export interface LivenessResult extends LivenessVerdict {
  /** Which free rung produced the verdict. Rung 3 (AI) lives in verify.ts. */
  rung: 1 | 2;
}

export type ProbeVendor = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters';

export interface LivenessProbe {
  vendor: ProbeVendor;
  apiUrl: string;
  /** For board-level APIs (Ashby) — the posting id to look up in the feed. */
  jobId: string;
}

export interface LivenessJobInput {
  url: string;
  externalId: string;
  atsType: string;
  atsToken: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const MIN_PAGE_TEXT_CHARS = 200;

/** Human wording for each code — used in flash messages and the chip title. */
export const LIVENESS_CODE_LABEL: Record<LivenessCode, string> = {
  api_ok: "the company's board API lists it as open",
  api_gone: 'the board API returns 404 for it',
  api_delisted: 'the board API no longer lists it',
  api_ambiguous: 'the board API answer was inconclusive',
  http_gone: 'the posting page returns 404',
  bot_challenge: 'the page sits behind a bot check',
  access_blocked: 'access to the page was blocked',
  server_error: 'the site answered with a server error',
  redirected_off_posting: 'the link now redirects away from the posting',
  closed_banner: 'the page says applications are closed',
  insufficient_content: 'the page rendered no readable content',
  page_ok: 'the posting page renders normally',
  unfetchable_url: 'the stored URL is not safely fetchable',
  network_error: 'the site could not be reached',
  conflicting_signals: 'the board API and the live page disagree',
};

const v = (liveness: Liveness, code: LivenessCode): LivenessVerdict => ({ liveness, code });

// ---------------------------------------------------------------------------
// Rung 1: probe resolution. SSRF by construction — fixed hosts only, and
// every interpolated path segment passes a charset that cannot express
// traversal ('..' is unrepresentable without dots, checked explicitly anyway).
// ---------------------------------------------------------------------------

const SEGMENT_RE = /^[A-Za-z0-9_-]{1,80}$/;
const seg = (s: string): boolean => SEGMENT_RE.test(s) && !s.includes('..');

const probe = (vendor: ProbeVendor, apiUrl: string, jobId: string): LivenessProbe => ({
  vendor,
  apiUrl,
  jobId,
});

/**
 * Company fields first (authoritative: `atsToken` is the board slug and
 * `externalId` the posting id for every tracked ATS row — stored Greenhouse
 * URLs are often custom domains and carry no board slug), URL patterns as
 * the fallback for MANUAL and aggregator jobs that point at hosted pages.
 */
export function resolveLivenessProbe(job: LivenessJobInput): LivenessProbe | null {
  return resolveFromCompany(job) ?? resolveFromUrl(job.url);
}

function resolveFromCompany({ atsType, atsToken, externalId }: LivenessJobInput): LivenessProbe | null {
  if (!seg(atsToken) || !seg(externalId)) return null;
  switch (atsType) {
    case 'GREENHOUSE':
      return probe(
        'greenhouse',
        `https://boards-api.greenhouse.io/v1/boards/${atsToken}/jobs/${externalId}`,
        externalId,
      );
    case 'LEVER':
      return probe('lever', `https://api.lever.co/v0/postings/${atsToken}/${externalId}`, externalId);
    case 'ASHBY':
      return probe('ashby', `https://api.ashbyhq.com/posting-api/job-board/${atsToken}`, externalId);
    case 'WORKABLE':
      return probe(
        'workable',
        `https://apply.workable.com/api/v2/accounts/${atsToken}/jobs/${externalId}`,
        externalId,
      );
    case 'SMARTRECRUITERS':
      return probe(
        'smartrecruiters',
        `https://api.smartrecruiters.com/v1/companies/${atsToken}/postings/${externalId}`,
        externalId,
      );
    default:
      return null;
  }
}

function resolveFromUrl(raw: string): LivenessProbe | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    const [board, jobs, id] = parts;
    if (board && jobs === 'jobs' && id && seg(board) && seg(id)) {
      return probe('greenhouse', `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`, id);
    }
    return null;
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    const apiHost = host === 'jobs.eu.lever.co' ? 'api.eu.lever.co' : 'api.lever.co';
    const [slug, id] = parts;
    if (slug && id && seg(slug) && seg(id)) {
      return probe('lever', `https://${apiHost}/v0/postings/${slug}/${id}`, id);
    }
    return null;
  }
  if (host === 'jobs.ashbyhq.com') {
    const [org, id] = parts;
    if (org && id && seg(org) && seg(id)) {
      return probe('ashby', `https://api.ashbyhq.com/posting-api/job-board/${org}`, id);
    }
    return null;
  }
  if (host === 'apply.workable.com') {
    const [slug, j, shortcode] = parts;
    if (slug && j === 'j' && shortcode && seg(slug) && seg(shortcode)) {
      return probe(
        'workable',
        `https://apply.workable.com/api/v2/accounts/${slug}/jobs/${shortcode}`,
        shortcode,
      );
    }
    return null;
  }
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') {
    // Path: /{Company}/{id}-{title-slug}. Company case matters to their API.
    const [company, jobSeg] = parts;
    const id = jobSeg ? /^(\d{6,20})/.exec(jobSeg)?.[1] : undefined;
    if (company && id && seg(company)) {
      return probe(
        'smartrecruiters',
        `https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`,
        id,
      );
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rung 1: API answer interpretation (pure).
// ---------------------------------------------------------------------------

const AshbyBoardSchema = z.object({
  jobs: z.array(z.object({ id: z.string(), isListed: z.boolean().optional() }).passthrough()),
});
const WorkableJobSchema = z.object({ state: z.string() });
const SmartRecruitersPostingSchema = z.object({ active: z.boolean() });

const WORKABLE_CLOSED_STATES = new Set(['closed', 'archived']);

export function interpretApiResult(
  vendor: ProbeVendor,
  status: number,
  body: string,
  jobId: string,
): LivenessVerdict {
  if (status === 401 || status === 403 || status === 429) return v('uncertain', 'access_blocked');
  if (status >= 500) return v('uncertain', 'server_error');

  if (vendor === 'lever') {
    // A Lever API 404 is non-authoritative: confidential postings 404 the
    // API while the public page is live with a working Apply.
    return status === 200 ? v('active', 'api_ok') : v('uncertain', 'api_ambiguous');
  }
  if (vendor === 'ashby') {
    // Board-level API: a 404 may just mean the org renamed its slug.
    if (status !== 200) return v('uncertain', 'api_ambiguous');
    const parsed = AshbyBoardSchema.safeParse(safeJson(body));
    if (!parsed.success) return v('uncertain', 'api_ambiguous');
    const lookFor = jobId.toLowerCase();
    const hit = parsed.data.jobs.find((j) => j.id.toLowerCase() === lookFor);
    if (!hit || hit.isListed === false) return v('expired', 'api_delisted');
    return v('active', 'api_ok');
  }

  // Greenhouse / Workable / SmartRecruiters: per-posting endpoints where a
  // 404 means the posting is gone (rung 2 still confirms — see the ladder).
  if (status === 404 || status === 410) return v('expired', 'api_gone');
  if (status !== 200) return v('uncertain', 'api_ambiguous');

  if (vendor === 'workable') {
    const parsed = WorkableJobSchema.safeParse(safeJson(body));
    if (!parsed.success) return v('uncertain', 'api_ambiguous');
    if (parsed.data.state === 'published') return v('active', 'api_ok');
    if (WORKABLE_CLOSED_STATES.has(parsed.data.state)) return v('expired', 'api_delisted');
    return v('uncertain', 'api_ambiguous');
  }
  if (vendor === 'smartrecruiters') {
    const parsed = SmartRecruitersPostingSchema.safeParse(safeJson(body));
    if (!parsed.success) return v('uncertain', 'api_ambiguous');
    return parsed.data.active ? v('active', 'api_ok') : v('expired', 'api_delisted');
  }
  return v('active', 'api_ok'); // greenhouse: a 200 is the posting itself
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rung 2: plain-fetch page classification (pure).
// ---------------------------------------------------------------------------

/** Markers of bot checkpoints — checked before any content heuristic. */
export const BOT_CHALLENGE_RES: RegExp[] = [
  /just a moment/,
  /checking your browser/,
  /verify (?:that )?you are (?:a )?human/,
  /enable javascript and cookies to continue/,
  /captcha/,
  /ddos protection/,
  /cf-browser-verification|cf_chl_/,
  /perimeterx|_px3/,
  /datadome/,
];

/**
 * Hard "this posting is closed" banners, multi-language. Every pattern is
 * anchored on a posting noun so prose like "once the form has been filled
 * out" or "closing date: 31 Dec" can never match (guard-tested).
 */
export const CLOSED_BANNER_RES: RegExp[] = [
  /no longer accepting applications/,
  /(?:position|role|vacancy|opening|job) has been filled(?! out)/,
  /(?:position|posting|job|role|vacancy|opening|offer)[^.!?\n]{0,60}(?:is |are |was )?(?:no longer|not currently) (?:available|active|open|published|accepting)/,
  /applications? (?:for this [a-zÀ-ɏ ]{0,30})?(?:is|are) (?:now )?closed/,
  /this (?:job|position|posting|vacancy) has (?:closed|expired|been closed)/,
  /stellen?(?:anzeige|angebot)?[^.!?\n]{0,60}nicht mehr (?:verfügbar|aktiv|ausgeschrieben|vakant)/,
  /(?:poste|offre)[^.!?\n]{0,60}(?:n['’]est plus (?:disponible|active?)|(?:a été|est) pourvue?)/,
  /(?:oferta|ogłoszenie|rekrutacja)[^.!?\n]{0,60}(?:nieaktualn|wygasł|zakończon)/,
  /вакансі[яюї][^.!?\n]{0,60}(?:закрит|неактуальн|більше недоступн)/,
  /(?:puesto|oferta|vacante)[^.!?\n]{0,60}(?:ya no está disponible|cerrad|cubiert)/,
];

/** Best-effort posting-id token from a job URL (uuid, long number, workable shortcode). */
export function postingIdFromUrl(url: string): string | null {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(url);
  if (uuid) return uuid[0];
  const wk = /\/j\/([A-Za-z0-9]{6,20})(?:[/?#]|$)/.exec(url);
  if (wk?.[1]) return wk[1];
  const num = /\d{6,20}/.exec(url);
  return num ? num[0] : null;
}

export function classifyLiveness(
  status: number,
  requestedUrl: string,
  finalUrl: string,
  body: string,
): LivenessVerdict {
  if (status === 404 || status === 410) return v('expired', 'http_gone');
  const raw = body.toLowerCase();
  if (BOT_CHALLENGE_RES.some((re) => re.test(raw))) return v('uncertain', 'bot_challenge');
  if (status === 401 || status === 403 || status === 429) return v('uncertain', 'access_blocked');
  if (status >= 500) return v('uncertain', 'server_error');
  if (status < 200 || status >= 300) return v('uncertain', 'access_blocked');

  // Redirect check BEFORE the banner scan: if we were bounced off the
  // posting, the page we read is not the posting — a banner on it proves
  // nothing and must never produce a false 'expired'.
  const id = postingIdFromUrl(requestedUrl);
  const moved = finalUrl !== '' && finalUrl !== requestedUrl;
  if (id && moved && !finalUrl.toLowerCase().includes(id.toLowerCase())) {
    return v('uncertain', 'redirected_off_posting');
  }
  if (!id && moved && hostOf(finalUrl) !== hostOf(requestedUrl)) {
    return v('uncertain', 'redirected_off_posting');
  }

  const text = stripHtml(body).toLowerCase();
  if (CLOSED_BANNER_RES.some((re) => re.test(text))) return v('expired', 'closed_banner');
  if (text.length < MIN_PAGE_TEXT_CHARS) return v('uncertain', 'insufficient_content');
  return v('active', 'page_ok');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Rung-2 SSRF guard for stored (possibly hand-pasted) URLs: http(s) only,
 * no credentials, no IP literals, no localhost/intranet names.
 */
export function isFetchableJobUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(':') || host.startsWith('[')) return false;
  if (!host.includes('.')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The ladder runner (the only I/O in this module).
// ---------------------------------------------------------------------------

export async function runLivenessLadder(job: LivenessJobInput): Promise<LivenessResult> {
  const p = resolveLivenessProbe(job);
  let rung1: LivenessVerdict | null = null;
  if (p) {
    rung1 = await checkAtsApi(p);
    if (rung1.liveness === 'active') return { ...rung1, rung: 1 };
  }
  const rung2 = await checkPostingPage(job.url);
  if (rung1?.liveness === 'expired') {
    // Stale-slug guard (ADR 0016): the API says gone, but if the live page
    // still affirmatively renders the posting, the signals conflict.
    return rung2.liveness === 'active'
      ? { liveness: 'uncertain', code: 'conflicting_signals', rung: 2 }
      : { ...rung1, rung: 1 };
  }
  return { ...rung2, rung: 2 };
}

async function checkAtsApi(p: LivenessProbe): Promise<LivenessVerdict> {
  const got = await fetchRaw(p.apiUrl, 'error');
  if (!got) return v('uncertain', 'network_error');
  return interpretApiResult(p.vendor, got.status, got.body, p.jobId);
}

async function checkPostingPage(url: string): Promise<LivenessVerdict> {
  if (!isFetchableJobUrl(url)) return v('uncertain', 'unfetchable_url');
  const got = await fetchRaw(url, 'follow');
  if (!got) return v('uncertain', 'network_error');
  // A public host can redirect into the private range. classifyLiveness would
  // reject the result anyway ('redirected_off_posting' fires on a host change),
  // but that check exists to spot a bounce off the posting, not to hold a
  // security boundary — re-run the guard so the refusal is deliberate.
  if (!isFetchableJobUrl(got.finalUrl)) return v('uncertain', 'unfetchable_url');
  return classifyLiveness(got.status, url, got.finalUrl, got.body);
}

// Not fetchWithRetry: here a 404 is a verdict, not an error to throw on,
// and rung 1 must refuse redirects while rung 2 must follow and record them.
async function fetchRaw(
  url: string,
  redirect: 'error' | 'follow',
): Promise<{ status: number; finalUrl: string; body: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      redirect,
      signal: controller.signal,
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: redirect === 'error' ? 'application/json' : 'text/html,*/*',
      },
    });
    const body = await resp.text().catch(() => '');
    return { status: resp.status, finalUrl: resp.url || url, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
