/**
 * The order the tick walks the sources in (docs/scale-plan.md §3). Pure.
 *
 * `id ASC` is the same order on every install, because the ids come from a
 * `seed.ts` that is byte-identical everywhere: install #1 and install #500
 * both ask the first seeded Greenhouse board first, and — with the polite
 * one-second delay between sources — the second one a second later, in
 * lockstep. Shuffling the walk costs nothing and turns a synchronised burst
 * into ordinary background noise.
 *
 * The order of the walk only: anything that has to be stable (which Adzuna
 * rows fall inside the monthly limit, ADR 0034) is decided from the
 * id-ordered list before this runs.
 */

/** Fisher–Yates over a copy. Seeded, so the shuffle itself is testable. */
export function shuffleSources<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** A fresh seed for one tick. */
export function tickSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

/** mulberry32 — small, well-spread, and not a security boundary. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
