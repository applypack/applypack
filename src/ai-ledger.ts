import { prisma } from './db';
import { logger } from './logger';
import { sendBudgetAlert } from './notifier';
import { SETTINGS_ID } from './settings';
import {
  budgetAlert,
  budgetAlertText,
  budgetMonth,
  ledgerRow,
  namedOpenAiRow,
  typicalMicro,
  type AnswerTimes,
  type LedgerInput,
  type PackSpend,
  type SpendGroup,
} from './ai-spend';
import type { AiBilling, AiFeature, AiOutcome } from './ai-usage';
import type { RecentAttempt } from './ai-health';

/*
 * The AI spend ledger's I/O (ADR 0055): one `ai_call` row per attempt, the
 * sums the pages read, and the monthly budget's warning. The decisions are
 * src/ai-spend.ts, pure.
 */

/** How many recent calls, or packs, an estimate is the middle of. */
const TYPICAL_OF = 20;

/**
 * One attempt into the ledger, and the row's id — null when it was not
 * written. Awaited, so a once-script that exits right after its call still
 * has the row, and never thrown: a ledger that cannot write must not fail
 * the AI call it describes.
 */
export async function recordAiCall(input: LedgerInput): Promise<number | null> {
  try {
    const row = ledgerRow(input);
    const { id } = await prisma.aiCall.create({ data: row, select: { id: true } });
    if (row.billing === 'billed' && (row.costMicroUsd ?? row.reportedMicroUsd ?? 0) > 0) await warnOnBudget(input.at);
    return id;
  } catch (err) {
    logger.warn({ err, feature: input.feature }, 'ai: ledger row not written');
    return null;
  }
}

/*
 * The ledger's two updates (ADR 0055 addendum 2026-10-18); every other row is
 * written once. A row is written when the transport answers, so a crash before
 * the caller has read the reply still leaves it on the record.
 */

/**
 * The caller could not read the reply (#463). Only an `ok` row turns: a
 * call's last row is the answer's, unless the ledger failed to write that one
 * and the last is a failed attempt before it.
 */
export async function markUnparsed(id: number | undefined): Promise<void> {
  if (id === undefined) return;
  try {
    await prisma.aiCall.updateMany({ where: { id, outcome: 'ok' }, data: { outcome: 'unparsed' satisfies AiOutcome } });
  } catch (err) {
    logger.warn({ err, id }, 'ai: ledger row not marked unparsed');
  }
}

/** The posting a tick scored before its row existed, named on the calls that scored it (#483). */
export async function attributeCalls(ids: readonly number[], jobId: number): Promise<void> {
  if (ids.length === 0) return;
  try {
    await prisma.aiCall.updateMany({ where: { id: { in: [...ids] }, jobId: null }, data: { jobId } });
  } catch (err) {
    logger.warn({ err, jobId }, 'ai: scoring calls not named on their posting');
  }
}

/** Billed money in one UTC month, micro-dollars: our price, else the vendor's own figure. */
async function billedMicroIn(month: string): Promise<number> {
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const [row] = await prisma.$queryRaw<{ micro: bigint | null }[]>`
    SELECT sum(COALESCE("costMicroUsd", "reportedMicroUsd")) AS "micro"
    FROM "ai_call"
    WHERE "billing" = 'billed' AND "at" >= ${from} AND "at" < ${to}`;
  return Number(row?.micro ?? 0);
}

export async function billedThisMonth(now = new Date()): Promise<number> {
  return billedMicroIn(budgetMonth(now));
}

/**
 * The 80 % and 100 % warnings, each once a month. The worker and the
 * dashboard both spend, so the conditional update decides which of them
 * sends: only the one that moved the marker forward does.
 */
async function warnOnBudget(now: Date): Promise<void> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { aiBudgetCents: true, aiBudgetAlerted: true },
  });
  const cents = settings?.aiBudgetCents;
  if (!cents) return;
  const month = budgetMonth(now);
  // The month's last warning is out: nothing left to send, so no sum to take on every billed call.
  if ((settings.aiBudgetAlerted ?? '') >= `${month}:100`) return;
  const billed = await billedMicroIn(month);
  const marker = budgetAlert(billed, cents, month, settings.aiBudgetAlerted);
  if (!marker) return;
  const claimed = await prisma.appSettings.updateMany({
    where: { id: SETTINGS_ID, OR: [{ aiBudgetAlerted: null }, { aiBudgetAlerted: { lt: marker } }] },
    data: { aiBudgetAlerted: marker },
  });
  if (claimed.count === 0) return;
  try {
    await sendBudgetAlert(budgetAlertText(billed, cents));
  } catch (err) {
    logger.warn({ err, marker }, 'ai: budget warning not delivered');
  }
}

/**
 * Names the OpenAI-compatible rows written with an empty model before
 * v2.63.7, and prices them (#621): the page's cost, the time a step takes
 * here and the estimate under a button all read a row by its model. Run on
 * every boot by init.ts; after the first, nothing is left to read.
 */
export async function fillUnnamedModels(): Promise<void> {
  const rows = await prisma.aiCall.findMany({ where: { engine: 'openai_api', model: '' } });
  for (const row of rows) {
    const named = namedOpenAiRow(row);
    if (named) await prisma.aiCall.update({ where: { id: row.id }, data: named });
  }
}

/** The ledger between two instants, grouped the way the AI usage page reads it: a feature on a model, on one kind of money. */
/** How far back an engine's last attempts are read, and how many of them: enough to see a run of failures, cheap by the `at` index. */
const RECENT_DAYS = 7;
const RECENT_ATTEMPTS = 20;

/**
 * Each engine's last attempts of the past week, newest first — what
 * `ai-health.ts:engineTroubles` reads to say an engine is failing now (#413).
 * Engine tests are in: a Test that answers is how a person sees the trouble
 * end.
 */
export async function loadRecentAttempts(now = new Date()): Promise<RecentAttempt[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  return prisma.$queryRaw<RecentAttempt[]>`
    SELECT "engine", "outcome", "at" FROM (
      SELECT "engine", "outcome", "at", "id", row_number() OVER (PARTITION BY "engine" ORDER BY "at" DESC, "id" DESC) AS "n"
      FROM "ai_call"
      WHERE "at" >= ${since}
    ) recent
    WHERE "n" <= ${RECENT_ATTEMPTS}
    ORDER BY "engine", "n"`;
}

export async function loadSpendGroups(from: Date, to: Date): Promise<SpendGroup[]> {
  // The model that answered, else the one asked for.
  const rows = await prisma.$queryRaw<
    {
      feature: string;
      engine: string;
      model: string;
      billing: AiBilling;
      calls: number;
      failed: number;
      unparsed: number;
      failedAs: string | null;
      noUsage: number;
      unpriced: number;
      tokensIn: bigint;
      tokensOut: bigint;
      micro: bigint;
      medianMs: number | null;
      p90Ms: number | null;
      rateLimited: number;
      viaFallback: number;
      fallbackMicro: bigint;
    }[]
  >`
    SELECT "feature", "engine", COALESCE("resolvedModel", "model") AS "model", "billing",
      count(*)::int AS "calls",
      count(*) FILTER (WHERE "outcome" <> 'ok')::int AS "failed",
      count(*) FILTER (WHERE "outcome" = 'unparsed')::int AS "unparsed",
      mode() WITHIN GROUP (ORDER BY "outcome") FILTER (WHERE "outcome" <> 'ok') AS "failedAs",
      count(*) FILTER (WHERE "outcome" <> 'ok' AND "inputTokens" IS NULL AND "outputTokens" IS NULL
        AND "cacheReadTokens" IS NULL AND "cacheWriteTokens" IS NULL AND "cacheWrite1hTokens" IS NULL)::int AS "noUsage",
      count(*) FILTER (WHERE "billing" <> 'local' AND "costMicroUsd" IS NULL AND "reportedMicroUsd" IS NULL
        AND ("inputTokens" IS NOT NULL OR "outputTokens" IS NOT NULL))::int AS "unpriced",
      COALESCE(sum(COALESCE("inputTokens", 0) + COALESCE("cacheReadTokens", 0) + COALESCE("cacheWriteTokens", 0)
        + COALESCE("cacheWrite1hTokens", 0)), 0)::bigint AS "tokensIn",
      COALESCE(sum("outputTokens"), 0)::bigint AS "tokensOut",
      COALESCE(sum(COALESCE("costMicroUsd", "reportedMicroUsd")), 0)::bigint AS "micro",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE "outcome" = 'ok') AS "medianMs",
      percentile_cont(0.9) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE "outcome" = 'ok') AS "p90Ms",
      count(*) FILTER (WHERE "outcome" = 'rate_limited')::int AS "rateLimited",
      count(*) FILTER (WHERE "viaFallback")::int AS "viaFallback",
      COALESCE(sum(COALESCE("costMicroUsd", "reportedMicroUsd")) FILTER (WHERE "viaFallback"), 0)::bigint AS "fallbackMicro"
    FROM "ai_call"
    WHERE "at" >= ${from} AND "at" < ${to}
    GROUP BY 1, 2, 3, 4`;
  return rows.map((r) => ({
    ...r,
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
    micro: Number(r.micro),
    medianMs: r.medianMs === null ? null : Math.round(r.medianMs),
    p90Ms: r.p90Ms === null ? null : Math.round(r.p90Ms),
    fallbackMicro: Number(r.fallbackMicro),
  }));
}

/**
 * How long each feature's last twenty answered calls took on the engines
 * given, per model asked for: the model the next call will ask for ('' = a
 * CLI's default), where a spend group is keyed by the one the vendor names.
 * A page reads it to say how long a step takes here, so it never throws.
 */
export async function loadAnswerTimes(engines: readonly string[], features: readonly AiFeature[]): Promise<AnswerTimes[]> {
  if (engines.length === 0 || features.length === 0) return [];
  try {
    const rows = await prisma.$queryRaw<AnswerTimes[]>`
      SELECT "feature", "engine", "model", count(*)::int AS "answered",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS "medianMs",
        percentile_cont(0.9) WITHIN GROUP (ORDER BY "durationMs") AS "p90Ms"
      FROM (
        SELECT "feature", "engine", "model", "durationMs",
          row_number() OVER (PARTITION BY "feature", "engine", "model" ORDER BY "at" DESC, "id" DESC) AS "n"
        FROM "ai_call"
        WHERE "outcome" = 'ok' AND "engine" = ANY(${[...engines]}) AND "feature" = ANY(${[...features]})
      ) recent
      WHERE "n" <= ${TYPICAL_OF}
      GROUP BY 1, 2, 3`;
    return rows.map((r) => ({ ...r, medianMs: Math.round(r.medianMs), p90Ms: Math.round(r.p90Ms) }));
  } catch (err) {
    logger.warn({ err }, 'ai: answer times not read');
    return [];
  }
}

/**
 * What a kind of call usually costs here: the middle of the last twenty that
 * answered, on the kind of money they spent — on one engine and model when
 * `on` names them.
 */
export async function typicalCost(
  feature: AiFeature,
  on?: { engine: string; model: string },
): Promise<{ micro: number; billing: AiBilling } | null> {
  const rows = await prisma.aiCall.findMany({
    where: { feature, outcome: 'ok', ...on },
    orderBy: { at: 'desc' },
    take: TYPICAL_OF,
    select: { billing: true, costMicroUsd: true, reportedMicroUsd: true },
  });
  const latest = rows[0];
  if (!latest) return null;
  // Only the calls on the kind of money the latest one spent: a plan estimate and a bill are not one sample.
  const costs = rows
    .filter((r) => r.billing === latest.billing)
    .map((r) => r.costMicroUsd ?? r.reportedMicroUsd)
    .filter((c): c is number => c !== null);
  const micro = typicalMicro(costs);
  return micro === null ? null : { micro, billing: latest.billing as AiBilling };
}

/** What the application packs' own calls came to between two instants (#487); calls made before the mark existed are not among them. */
export async function loadPackSpend(from: Date, to: Date): Promise<PackSpend> {
  const [rows, [packs]] = await Promise.all([
    prisma.$queryRaw<{ billing: AiBilling; calls: number; micro: bigint }[]>`
      SELECT "billing", count(*)::int AS "calls", COALESCE(sum(COALESCE("costMicroUsd", "reportedMicroUsd")), 0)::bigint AS "micro"
      FROM "ai_call" WHERE "packId" IS NOT NULL AND "at" >= ${from} AND "at" < ${to} GROUP BY 1`,
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT "packId")::int AS "n" FROM "ai_call" WHERE "packId" IS NOT NULL AND "at" >= ${from} AND "at" < ${to}`,
  ]);
  return {
    packs: packs?.n ?? 0,
    calls: rows.reduce((n, r) => n + r.calls, 0),
    spend: Object.fromEntries(rows.map((r) => [r.billing, Number(r.micro)])),
  };
}

/**
 * What each of the last packs prepared to the end spent, by kind of money —
 * the calls of its latest preparation only: a pack prepared again keeps its
 * row, and the first attempt's calls are not this one's price.
 */
export async function recentPackSpends(): Promise<Partial<Record<AiBilling, number>>[]> {
  const rows = await prisma.$queryRaw<{ packId: number; billing: AiBilling; micro: bigint }[]>`
    WITH recent AS (
      SELECT p."id", p."startedAt" FROM "application_pack" p
      WHERE p."status" = 'ready' AND EXISTS (SELECT 1 FROM "ai_call" c WHERE c."packId" = p."id" AND c."at" >= p."startedAt")
      ORDER BY p."finishedAt" DESC
      LIMIT ${TYPICAL_OF}
    )
    SELECT c."packId", c."billing", COALESCE(sum(COALESCE(c."costMicroUsd", c."reportedMicroUsd")), 0)::bigint AS "micro"
    FROM "ai_call" c JOIN recent r ON r."id" = c."packId" AND c."at" >= r."startedAt"
    GROUP BY 1, 2`;
  const byPack = new Map<number, Partial<Record<AiBilling, number>>>();
  for (const r of rows) byPack.set(r.packId, { ...byPack.get(r.packId), [r.billing]: Number(r.micro) });
  return [...byPack.values()];
}

/** What the AI spent on one posting, by kind of money, micro-dollars — null when nothing was recorded for it. */
export async function jobSpend(jobId: number): Promise<Partial<Record<AiBilling, number>> | null> {
  const rows = await prisma.$queryRaw<{ billing: AiBilling; micro: bigint | null }[]>`
    SELECT "billing", sum(COALESCE("costMicroUsd", "reportedMicroUsd")) AS "micro"
    FROM "ai_call" WHERE "jobId" = ${jobId} GROUP BY 1`;
  if (rows.length === 0) return null;
  return Object.fromEntries(rows.map((r) => [r.billing, Number(r.micro ?? 0)]));
}

/** A ledger attempt as the window check reads it (web/window-misfits.ts). */
export interface WindowAttempt {
  engine: string;
  feature: string;
  at: Date;
  durationMs: number;
  outcome: string;
}

/**
 * The prompts an engine refused as too large for its window since `since`
 * (#411), and the fallback attempts at the same features that could have
 * answered them. Two reads by the `at` index; one when nothing was refused.
 */
export async function loadWindowRefusals(since: Date): Promise<{ refusals: WindowAttempt[]; fallbacks: WindowAttempt[] }> {
  const select = { engine: true, feature: true, at: true, durationMs: true, outcome: true } as const;
  const refusals = await prisma.aiCall.findMany({ where: { outcome: 'too_large', at: { gte: since } }, select });
  if (refusals.length === 0) return { refusals, fallbacks: [] };
  const fallbacks = await prisma.aiCall.findMany({
    where: { viaFallback: true, at: { gte: since }, feature: { in: [...new Set(refusals.map((r) => r.feature))] } },
    select,
  });
  return { refusals, fallbacks };
}
