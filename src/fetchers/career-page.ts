import { prisma } from '../db';
import { logger } from '../logger';
import { fetchWithRetry } from '../http';
import { checkPostingUrl } from '../jobs/posting-url';
import { looksLikeChallenge } from '../watchlist/scan';
import { decideChange } from '../watchlist/page-hash';
import { stagePageChange } from '../watchlist/page-changes';
import { conditionalHeaders, rememberResponse } from './conditional';
import type { NormalizedJob } from '../types';

/**
 * The last rung of the watchlist (TASKS §17 stage C, ADR 0036): a careers
 * page with no board and no feed behind it.
 *
 * **It never returns a job, and that is the point.** It reads the page, hashes
 * its text, and stages "this changed" for the tick to report. It does not
 * guess at postings from a layout, because the layout is not a contract — see
 * `watchlist/page-hash.ts` for what the hash ignores and why the §17 plan's
 * digit masking was dropped.
 *
 * Returning `[]` means `classifyFetchCount` reads it as `empty`, which is the
 * truth: this source produces no postings, ever. Its health therefore rests on
 * the failure streak alone — a page that 404s or starts answering a bot check
 * still goes quiet on `/companies` the ordinary way.
 */
const TIMEOUT_MS = 15_000;

export interface CareerPageCompany {
  id: number;
  name: string;
  /** The careers page URL. */
  atsToken: string;
  lastContentHash: string | null;
  lastContentAlertAt: Date | null;
}

export async function fetchCareerPage(company: CareerPageCompany): Promise<NormalizedJob[]> {
  const url = careerPageUrl(company.atsToken);
  const resp = await fetchWithRetry(url, {
    timeoutMs: TIMEOUT_MS,
    init: { headers: conditionalHeaders(company.id, url) },
  });
  // Redirects are followed, so the host that answered is checked again — the
  // same rule every user-URL fetch in this project follows.
  careerPageUrl(resp.url || url);
  const html = await resp.text();

  // A bot check is not a change; hashing it would report the interstitial as
  // news, and then report the real page as news again once it lets us back in.
  if (looksLikeChallenge(html)) {
    throw new Error(`career-page: ${url} answered with a bot check`);
  }

  const decision = decideChange(company, html, new Date());
  if (decision.kind === 'first') {
    // No previous text to differ from: remember it and say nothing.
    await prisma.company.update({ where: { id: company.id }, data: { lastContentHash: decision.hash } });
    logger.info({ company: company.name }, 'career-page: first read, nothing to report');
  } else if (decision.kind === 'changed') {
    stagePageChange({ companyId: company.id, companyName: company.name, url, hash: decision.hash });
  } else if (decision.kind === 'held') {
    logger.info({ company: company.name }, 'career-page: changed again inside the daily window; still pending');
  }
  // A validator is only worth keeping when there is nothing to chase.
  rememberResponse(company.id, url, resp, 0);
  return [];
}

/** The token as a URL, refused if it is not one we are allowed to fetch. */
export function careerPageUrl(atsToken: string): string {
  const checked = checkPostingUrl(atsToken);
  if (!checked.ok) throw new Error(`career-page: ${checked.error}`);
  return checked.url.toString();
}
