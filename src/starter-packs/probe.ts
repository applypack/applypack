/**
 * Runs a starter pack's resolve plans against the live ATS endpoints. Talks
 * HTTP (through `probeAts`) but never touches the DB — the caller decides what
 * to insert.
 */

import type { AtsType } from '@prisma/client';
import { probeAts } from '../ats-probe';
import { createLimiter } from '../concurrency';
import {
  MIN_JOBS_TO_ACCEPT,
  boardUrl,
  buildResolvePlan,
  type ResolveTarget,
  type ResolvedEntry,
  type UnresolvedEntry,
} from './resolve';

/** Polite parallelism: enough to keep a 30-name pack quick, low enough that a
 *  vendor does not see a burst (Workable starts answering 429 well before). */
const PACK_CONCURRENCY = 4;

/** Whole-pack wall-clock ceiling. Whatever has not resolved when it expires is
 *  reported as unresolved rather than left hanging on the request. */
const PACK_BUDGET_MS = 60_000;

export interface PackResolution {
  resolved: ResolvedEntry[];
  unresolved: UnresolvedEntry[];
}

export async function resolvePack(
  targets: readonly ResolveTarget[],
  budgetMs: number = PACK_BUDGET_MS,
): Promise<PackResolution> {
  const limit = createLimiter(PACK_CONCURRENCY);
  const deadline = Date.now() + budgetMs;

  const settled = await Promise.all(
    targets.map((target) => limit(() => resolveOne(target, deadline))),
  );

  const resolved: ResolvedEntry[] = [];
  const unresolved: UnresolvedEntry[] = [];
  for (const entry of settled) {
    if ('jobsCount' in entry) resolved.push(entry);
    else unresolved.push(entry);
  }
  return { resolved, unresolved };
}

async function resolveOne(
  target: ResolveTarget,
  deadline: number,
): Promise<ResolvedEntry | UnresolvedEntry> {
  let lastError = 'no board found on any supported ATS';

  for (const attempt of buildResolvePlan(target)) {
    if (Date.now() > deadline) {
      return { name: target.name, segment: target.segment, reason: 'timed out' };
    }

    const probe = await probeAts(attempt.atsType as AtsType, attempt.atsToken);
    if (!probe.ok) {
      if (attempt.pinned) lastError = probe.error ?? 'probe failed';
      continue;
    }
    // A board that exists but holds nothing is not proof of identity —
    // SmartRecruiters answers 200 with an empty list for any slug (ADR 0017).
    if ((probe.jobsCount ?? 0) < MIN_JOBS_TO_ACCEPT) {
      if (attempt.pinned) lastError = 'board answered, but has no open jobs';
      continue;
    }

    return {
      ...target,
      atsType: attempt.atsType,
      atsToken: attempt.atsToken,
      pinned: attempt.pinned,
      jobsCount: probe.jobsCount ?? 0,
      boardUrl: boardUrl(attempt.atsType, attempt.atsToken),
    };
  }

  return { name: target.name, segment: target.segment, reason: lastError };
}
