/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { idParam } from '../params';
import { AtsType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { sleep } from '../../http';
import { firstIssue, flashRedirect, refusedField } from '../flash';
import { ALERT_POLICIES, CHECK_INTERVALS } from '../../watchlist/interval';
import { parseCompanyLines } from '../../watchlist/parse-input';
import { installAiTokens, liveResolveIo, resolveCompanyUrl, type ResolvedCompany } from '../../watchlist/resolve';
import { verdictLine } from '../../watchlist/verdict';
import {
  activeWatchlistRun,
  createWatchlistRun,
  finishWatchlistRun,
  getWatchlistRun,
  markResolving,
  recordResolved,
  startWatchlistRun,
} from '../watchlist-runs';
import { WatchlistPreviewPage, WatchlistRunPage } from '../pages/watchlist';
import { newLines, pageLines, pasteSummary, roleLines, titleWordsOf } from '../../watchlist/paste';
import { beginFetchNow } from '../fetch-now';
import { activeFetchRun } from '../fetch-runs';
import { listActiveProfiles } from '../../profiles';
import { isBlankProfile } from '../../profile-guards';
import { formatDate } from '../format';
import { t } from '../../i18n/t';

/*
 * The watchlist's own routes (TASKS §17 stage A, ADR 0036): paste a list,
 * watch it resolve, confirm the preview, then manage the rows.
 *
 * The preview's confirm re-reads the resolution from the run in memory
 * rather than from the form. The browser round-trips it, so it is not
 * trusted input — the same rule the starter-pack import follows (ADR 0017);
 * only the name and the ticks come from the user.
 */

/** A polite gap between companies, the same second the tick leaves boards. */
const BETWEEN_COMPANIES_MS = 1_000;

export const watchlistRoute = new Hono();

watchlistRoute.post('/companies/watchlist', async (c) => {
  const form = await c.req.parseBody();
  const parsed = parseCompanyLines(typeof form.urls === 'string' ? form.urls : '');
  if (parsed.rows.length === 0) {
    return flashRedirect('/companies', 'err', t('watchlist.flash.noUrls'));
  }
  // No await between the guard and the create — a double submit lands on one run.
  const active = activeWatchlistRun();
  if (active) return c.redirect(`/companies/watchlist/${active.id}`, 303);

  const run = createWatchlistRun(parsed.rows.length, parsed.rejected);
  const io = await liveResolveIo();
  // Read once for the whole run, so every URL of one paste is judged against
  // the same engine list (ADR 0036).
  const aiTokens = await installAiTokens();
  startWatchlistRun(run.id, async () => {
    for (const input of parsed.rows) {
      markResolving(run.id, input.url);
      recordResolved(run.id, await resolveCompanyUrl(input, io, { aiTokens }));
      await sleep(BETWEEN_COMPANIES_MS);
    }
    finishWatchlistRun(run.id);
    logger.info({ resolved: parsed.rows.length }, 'watchlist: resolve run finished');
  });
  return c.redirect(`/companies/watchlist/${run.id}`, 303);
});

/** Polled by the progress page. */
watchlistRoute.get('/companies/watchlist/:id/state', (c) => {
  const run = getWatchlistRun(c.req.param('id'));
  if (!run) return c.json({ gone: true }, 404);
  return c.json({
    done: run.done,
    total: run.total,
    resolved: run.results.length,
    current: run.current,
    rows: run.results.map((r) => ({ name: r.name, verdict: verdictLine(r.resolution) })),
  });
});

watchlistRoute.get('/companies/watchlist/:id', (c) => {
  const run = getWatchlistRun(c.req.param('id'));
  if (!run) {
    return flashRedirect('/companies', 'err', t('watchlist.flash.expired'));
  }
  return c.html(run.done ? <WatchlistPreviewPage run={run} /> : <WatchlistRunPage run={run} />);
});

const AddSchema = z.object({
  runId: z.string().min(1),
  checkEvery: z.enum(CHECK_INTERVALS),
  alertPolicy: z.enum(ALERT_POLICIES),
});

watchlistRoute.post('/companies/watchlist/add', async (c) => {
  // Repeated checkboxes collapse to the last value without `all` (gotcha 1).
  const form = await c.req.parseBody({ all: true });
  const parsed = AddSchema.safeParse({
    runId: form.runId,
    checkEvery: form.checkEvery,
    alertPolicy: form.alertPolicy,
  });
  if (!parsed.success) {
    return flashRedirect('/companies', 'err', t('watchlist.flash.addInvalid', { issue: firstIssue(parsed.error.issues) }), refusedField(c.req.path, parsed.error.issues));
  }
  const run = getWatchlistRun(parsed.data.runId);
  if (!run) return flashRedirect('/companies', 'err', t('watchlist.flash.expired'));

  const picked = new Set(toList(form.pick));
  let added = 0;
  let skipped = 0;
  for (const result of run.results) {
    if (!picked.has(result.input.url)) continue;
    const source = sourceOf(result);
    // Only what the resolver actually confirmed may be written; the browser
    // round-trips the row, so the verdict is re-read here, not accepted.
    if (source === null) {
      skipped++;
      continue;
    }
    const typed = form[`name:${result.input.url}`];
    const name = (typeof typed === 'string' && typed.trim().length > 0 ? typed.trim() : result.name).slice(0, 100);
    const watch = {
      // Watched rows go in switched ON: unlike a starter pack, the user named
      // these companies one by one and asked to be told about them. A page
      // drawn in the browser is the exception — the tick has nothing to read.
      active: source.atsType !== AtsType.BROWSER_PAGE,
      watched: true,
      checkEvery: parsed.data.checkEvery,
      alertPolicy: parsed.data.alertPolicy,
      // NULL = due on the next tick, which is what "watch this" means.
      nextCheckAt: null,
      ...(source.crawlDelayMs !== undefined && { crawlDelayMs: source.crawlDelayMs }),
    };
    // A board already in the rotation (seeded, or from a pack) is UPDATED, not
    // skipped: the user has just said they want to watch that company, and
    // refusing because we happened to know the board already would be a
    // surprise. The name they typed is not forced over an existing row's,
    // though — that one may have been edited on purpose.
    const before = await prisma.company.findUnique({
      where: { atsType_atsToken: { atsType: source.atsType, atsToken: source.atsToken } },
      select: { watched: true },
    });
    try {
      await prisma.company.upsert({
        where: { atsType_atsToken: { atsType: source.atsType, atsToken: source.atsToken } },
        create: { name, atsType: source.atsType, atsToken: source.atsToken, careerUrl: result.careerUrl, ...watch },
        update: watch,
      });
      if (before?.watched === true) skipped++;
      else added++;
    } catch (err) {
      logger.error({ err, name }, 'watchlist: could not add a company');
      skipped++;
    }
  }
  logger.info({ added, skipped }, 'watchlist: companies added');
  return flashRedirect(
    '/companies',
    added > 0 ? 'ok' : 'err',
    added > 0
      ? t(skipped > 0 ? 'watchlist.flash.watchingSkipped' : 'watchlist.flash.watching', { n: added, skipped })
      : t('watchlist.flash.alreadyWatched'),
  );
});

const WatchSchema = z.object({
  checkEvery: z.enum(CHECK_INTERVALS),
  alertPolicy: z.enum(ALERT_POLICIES),
});

/** Interval / policy from the watchlist row's own selects. */
watchlistRoute.post('/companies/:id/watch', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const parsed = WatchSchema.safeParse({ checkEvery: form.checkEvery, alertPolicy: form.alertPolicy });
  if (!parsed.success) {
    return flashRedirect('/companies', 'err', t('watchlist.flash.watchInvalid', { issue: firstIssue(parsed.error.issues) }), refusedField(c.req.path, parsed.error.issues));
  }
  const company = await prisma.company.findUnique({ where: { id }, select: { name: true, checkEvery: true } });
  if (!company) return c.text('Not found', 404);

  await prisma.company.update({
    where: { id },
    data: {
      watched: true,
      checkEvery: parsed.data.checkEvery,
      alertPolicy: parsed.data.alertPolicy,
      // A shorter interval should take effect now, not after the old one
      // elapses — the user just asked for it.
      ...(parsed.data.checkEvery !== company.checkEvery ? { nextCheckAt: null } : {}),
    },
  });
  return flashRedirect('/companies', 'ok', t('watchlist.flash.updated', { name: company.name }));
});

/**
 * "Check now" (TASKS S23): that one company, now, on the progress page every
 * other fetch uses. It shares the fetch lock, so while another fetch runs the
 * row is made due on the next heartbeat instead, as it always was.
 */
watchlistRoute.post('/companies/:id/check-now', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const company = await prisma.company.findUnique({ where: { id }, select: { name: true, active: true, atsType: true } });
  if (!company) return c.text('Not found', 404);
  if (!company.active) {
    return flashRedirect('/companies', 'err', t('watchlist.flash.off', { name: company.name }));
  }
  if (activeFetchRun() === null) {
    const run = await beginFetchNow({ backUrl: '/companies', scope: { companyId: id, name: company.name, folder: company.atsType === AtsType.FOLDER } });
    return c.redirect(`/runs/fetch-now/${run.id}`, 303);
  }
  await prisma.company.update({ where: { id }, data: { nextCheckAt: null } });
  return flashRedirect('/companies', 'ok', t('watchlist.flash.fetchRunning', { name: company.name }));
});

/** Drop the star, keep the company: it stays a tracked source on the normal rules. */
watchlistRoute.post('/companies/:id/unwatch', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const company = await prisma.company.findUnique({ where: { id }, select: { name: true } });
  if (!company) return c.text('Not found', 404);
  await prisma.company.update({
    where: { id },
    data: { watched: false, alertPolicy: 'matches', checkEvery: 'hour' },
  });
  return flashRedirect('/companies', 'ok', t('watchlist.flash.unwatched', { name: company.name }));
});

/**
 * TASKS N8: the text of a page drawn in the browser, as the user copied it.
 * Read into lines and compared with the last paste; nothing becomes a Job
 * and nothing spends AI.
 */
watchlistRoute.post('/companies/:id/paste', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const company = await prisma.company.findUnique({
    where: { id },
    select: { name: true, atsType: true, pastedLines: true, pastedAt: true },
  });
  if (!company) return c.text('Not found', 404);
  if (company.atsType !== AtsType.BROWSER_PAGE) {
    return flashRedirect('/companies', 'err', t('watchlist.flash.notBrowserPage', { name: company.name }));
  }
  const body = await c.req.parseBody();
  const lines = pageLines(typeof body.page === 'string' ? body.page : '');
  if (lines.length === 0) {
    return flashRedirect('/companies#browser-pages', 'err', t('watchlist.flash.emptyPaste', { name: company.name }));
  }
  const added = company.pastedAt === null ? [] : newLines(company.pastedLines, lines);
  const searches = titleWordsOf((await listActiveProfiles()).filter((p) => !isBlankProfile(p)));
  await prisma.company.update({ where: { id }, data: { pastedLines: lines, pastedNew: added, pastedAt: new Date() } });
  return flashRedirect(
    '/companies#browser-pages',
    'ok',
    pasteSummary({
      name: company.name,
      lines: lines.length,
      since: company.pastedAt === null ? null : formatDate(company.pastedAt),
      added: added.length,
      roles: roleLines(company.pastedAt === null ? lines : added, searches),
    }),
  );
});

/** The (atsType, atsToken) a confirmed resolution becomes — with the site's own pacing for a row on its host — or null. */
function sourceOf(r: ResolvedCompany): { atsType: AtsType; atsToken: string; crawlDelayMs?: number | null } | null {
  if (r.resolution.kind === 'ats') return { atsType: r.resolution.atsType, atsToken: r.resolution.atsToken };
  if (r.resolution.kind === 'feed') return { atsType: AtsType.FEED, atsToken: r.resolution.url, crawlDelayMs: r.resolution.crawlDelayMs };
  // The last rungs: no postings, just "this page changed" (ADR 0036), or a
  // page drawn in the browser that the user pastes (TASKS N8).
  if (r.resolution.kind === 'changeWatch') {
    return { atsType: AtsType.CAREER_PAGE, atsToken: r.resolution.url, crawlDelayMs: r.resolution.crawlDelayMs };
  }
  if (r.resolution.kind === 'needsBrowser') return { atsType: AtsType.BROWSER_PAGE, atsToken: r.resolution.url };
  return null;
}


/** Form fields that arrive as string | string[] | File. */
function toList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}
