/**
 * Runs a starter pack's resolve plans against the live ATS endpoints. Talks
 * HTTP (through `probeAts`) but never touches the DB — the caller decides what
 * to insert.
 */

import type { AtsType } from '@prisma/client';
import { probeAts } from '../ats-probe';
import { createLimiter } from '../concurrency';
import { resolveEntry, type PackResolution, type ResolveTarget } from './resolve';

/** Polite parallelism: enough to keep a 30-name pack quick, low enough that a
 *  vendor does not see a burst (Workable starts answering 429 well before). */
const PACK_CONCURRENCY = 4;

/** Whole-pack wall-clock ceiling. Whatever has not resolved when it expires is
 *  reported as unresolved rather than left hanging on the request. */
const PACK_BUDGET_MS = 60_000;

export async function resolvePack(
  targets: readonly ResolveTarget[],
  budgetMs: number = PACK_BUDGET_MS,
): Promise<PackResolution> {
  const limit = createLimiter(PACK_CONCURRENCY);
  const deadline = Date.now() + budgetMs;

  const outcomes = await Promise.all(
    targets.map((target) =>
      limit(() => resolveEntry(target, (a) => probeAts(a.atsType as AtsType, a.atsToken), deadline)),
    ),
  );

  const resolution: PackResolution = { resolved: [], quiet: [], unresolved: [] };
  for (const outcome of outcomes) {
    if (outcome.kind === 'resolved') resolution.resolved.push(outcome.entry);
    else if (outcome.kind === 'quiet') resolution.quiet.push(outcome.entry);
    else resolution.unresolved.push(outcome.entry);
  }
  return resolution;
}
