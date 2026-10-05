import { prisma } from './db';
import { logger } from './logger';
import { sendBudgetAlert } from './notifier';
import { SETTINGS_ID } from './settings';
import {
  budgetAlert,
  budgetAlertText,
  budgetMonth,
  ledgerRow,
  typicalMicro,
  type LedgerInput,
  type SpendGroup,
} from './ai-spend';
import type { AiBilling, AiFeature } from './ai-usage';

/*
 * The AI spend ledger's I/O (ADR 0055): one `ai_call` row per attempt, the
 * sums the pages read, and the monthly budget's warning. The decisions are
 * src/ai-spend.ts, pure.
 */

/** How many recent calls an estimate is the middle of. */
const TYPICAL_OF = 20;

/**
 * One attempt into the ledger. Awaited, so a once-script that exits right
 * after its call still has the row, and never thrown: a ledger that cannot
 * write must not fail the AI call it describes.
 */
export async function recordAiCall(input: LedgerInput): Promise<void> {
  try {
    const row = ledgerRow(input);
    await prisma.aiCall.create({ data: row });
    if (row.billing === 'billed' && (row.costMicroUsd ?? row.reportedMicroUsd ?? 0) > 0) await warnOnBudget(input.at);
  } catch (err) {
    logger.warn({ err, feature: input.feature }, 'ai: ledger row not written');
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

/** The ledger between two instants, grouped the way the AI usage page reads it: a feature on a model, on one kind of money. */
export async function loadSpendGroups(from: Date, to: Date): Promise<SpendGroup[]> {
  const rows = await prisma.$queryRaw<
    {
      feature: string;
      engine: string;
      model: string;
      billing: AiBilling;
      calls: number;
      failed: number;
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

/** What a kind of call usually costs here: the middle of the last twenty that answered, on the kind of money they spent. */
export async function typicalCost(feature: AiFeature): Promise<{ micro: number; billing: AiBilling } | null> {
  const rows = await prisma.aiCall.findMany({
    where: { feature, outcome: 'ok' },
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

/** What the AI spent on one posting, by kind of money, micro-dollars — null when nothing was recorded for it. */
export async function jobSpend(jobId: number): Promise<Partial<Record<AiBilling, number>> | null> {
  const rows = await prisma.$queryRaw<{ billing: AiBilling; micro: bigint | null }[]>`
    SELECT "billing", sum(COALESCE("costMicroUsd", "reportedMicroUsd")) AS "micro"
    FROM "ai_call" WHERE "jobId" = ${jobId} GROUP BY 1`;
  if (rows.length === 0) return null;
  return Object.fromEntries(rows.map((r) => [r.billing, Number(r.micro ?? 0)]));
}
