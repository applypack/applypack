/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { AtsType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { sleep } from '../../http';
import { flashRedirect } from '../flash';
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
    return flashRedirect('/companies', 'err', 'No URLs in that list — one per line, or "Name — https://…".');
  }
  // No await between the guard and the create — a double submit lands on one run.
  const active = activeWatchlistRun();
  if (active) return c.redirect(`/companies/watchlist/${active.id}`, 303);

  const run = createWatchlistRun(parsed.rows.length, parsed.rejected);
  const io = liveResolveIo();
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
    return flashRedirect('/companies', 'err', 'That resolve run has expired — paste the list again.');
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
  if (!parsed.success) return flashRedirect('/companies', 'err', 'Invalid form values.');
  const run = getWatchlistRun(parsed.data.runId);
  if (!run) return flashRedirect('/companies', 'err', 'That resolve run has expired — paste the list again.');

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
      // these companies one by one and asked to be told about them.
      active: true,
      watched: true,
      checkEvery: parsed.data.checkEvery,
      alertPolicy: parsed.data.alertPolicy,
      // NULL = due on the next tick, which is what "watch this" means.
      nextCheckAt: null,
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
      ? `Watching ${added} compan${added === 1 ? 'y' : 'ies'}${skipped > 0 ? ` (${skipped} already watched)` : ''} — first check on the next tick.`
      : 'Nothing changed — those companies are already watched.',
  );
});

const WatchSchema = z.object({
  checkEvery: z.enum(CHECK_INTERVALS),
  alertPolicy: z.enum(ALERT_POLICIES),
});

/** Interval / policy from the watchlist row's own selects. */
watchlistRoute.post('/companies/:id/watch', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const form = await c.req.parseBody();
  const parsed = WatchSchema.safeParse({ checkEvery: form.checkEvery, alertPolicy: form.alertPolicy });
  if (!parsed.success) return flashRedirect('/companies', 'err', 'Invalid form values.');
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
  return flashRedirect('/companies', 'ok', `${company.name} updated.`);
});

/** "Check now": due on the next heartbeat, whatever the interval said. */
watchlistRoute.post('/companies/:id/check-now', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const company = await prisma.company.findUnique({ where: { id }, select: { name: true } });
  if (!company) return c.text('Not found', 404);
  await prisma.company.update({ where: { id }, data: { nextCheckAt: null } });
  return flashRedirect(
    '/companies',
    'ok',
    `${company.name} will be checked on the next tick — press "Fetch now" to run one straight away.`,
  );
});

/** Drop the star, keep the company: it stays a tracked source on the normal rules. */
watchlistRoute.post('/companies/:id/unwatch', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const company = await prisma.company.findUnique({ where: { id }, select: { name: true } });
  if (!company) return c.text('Not found', 404);
  await prisma.company.update({
    where: { id },
    data: { watched: false, alertPolicy: 'matches', checkEvery: 'hour' },
  });
  return flashRedirect('/companies', 'ok', `${company.name} is no longer watched — it stays in the hourly tick.`);
});

/** The (atsType, atsToken) a confirmed resolution becomes, or null. */
export function sourceOf(r: ResolvedCompany): { atsType: AtsType; atsToken: string } | null {
  if (r.resolution.kind === 'ats') return { atsType: r.resolution.atsType, atsToken: r.resolution.atsToken };
  if (r.resolution.kind === 'feed') return { atsType: AtsType.FEED, atsToken: r.resolution.url };
  return null;
}


/** Form fields that arrive as string | string[] | File. */
function toList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}
