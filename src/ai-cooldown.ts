/*
 * In-process cooldown for AI engines (docs/ai-engine-improvements.md item 2).
 * Without it, a dead primary engine burns its retries + timeout on EVERY job
 * of a bulk run before the chain falls over. After `threshold` consecutive
 * failures an engine is skipped for `cooldownMs`; one success resets it.
 * Pure factory with an injectable clock — unit-tested.
 */

export interface CooldownTracker {
  failure(id: string): void;
  success(id: string): void;
  /** Epoch ms until which the engine should be skipped, or null. */
  blockedUntil(id: string): number | null;
}

export const COOLDOWN_FAILURE_THRESHOLD = 3;
export const COOLDOWN_MS = 60_000;

export function createCooldownTracker(
  opts: { threshold?: number; cooldownMs?: number; now?: () => number } = {},
): CooldownTracker {
  const threshold = opts.threshold ?? COOLDOWN_FAILURE_THRESHOLD;
  const cooldownMs = opts.cooldownMs ?? COOLDOWN_MS;
  const now = opts.now ?? Date.now;
  const state = new Map<string, { failures: number; until: number }>();

  return {
    failure(id) {
      const s = state.get(id) ?? { failures: 0, until: 0 };
      s.failures += 1;
      if (s.failures >= threshold) s.until = now() + cooldownMs;
      state.set(id, s);
    },
    success(id) {
      state.delete(id);
    },
    blockedUntil(id) {
      const s = state.get(id);
      if (!s || s.until <= now()) return null;
      return s.until;
    },
  };
}
