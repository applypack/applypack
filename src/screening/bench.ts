/*
 * The numbers a gold set gives (hr-screening-plan.md stage 0, plan §6
 * stage E): how the table's order compares with a human's, how stable a
 * score is between two runs of the same text, and whether the gates were
 * read as the human read them. Pure — the bench script feeds it what the
 * calls returned.
 */

/**
 * Kendall's τ-a between two orders of the same items (item ids, best
 * first): +1 identical, −1 reversed, 0 unrelated. Items missing from either
 * order are left out.
 */
export function kendallTau(human: string[], system: string[]): number | null {
  const pos = new Map(system.map((id, i) => [id, i]));
  const items = human.filter((id) => pos.has(id));
  if (items.length < 2) return null;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const d = pos.get(items[i]!)! - pos.get(items[j]!)!;
      if (d < 0) concordant++;
      else if (d > 0) discordant++;
    }
  }
  return Math.round(((concordant - discordant) / (concordant + discordant)) * 100) / 100;
}

/** How many of the human's top k the system also put in its top k. */
export function precisionAtK(human: string[], system: string[], k: number): { hit: number; k: number } {
  const top = new Set(system.slice(0, k));
  return { hit: human.slice(0, k).filter((id) => top.has(id)).length, k: Math.min(k, human.length, system.length) };
}

export type GateWord = 'pass' | 'unknown' | 'fail';
export const GATE_WORDS: GateWord[] = ['pass', 'unknown', 'fail'];

/** Rows = what the human said, columns = what the run said; `agree` counts the diagonal. */
export function gateConfusion(pairs: { expected: GateWord; got: GateWord }[]): { matrix: Record<GateWord, Record<GateWord, number>>; agree: number; total: number } {
  const matrix = Object.fromEntries(GATE_WORDS.map((e) => [e, Object.fromEntries(GATE_WORDS.map((g) => [g, 0]))])) as Record<GateWord, Record<GateWord, number>>;
  let agree = 0;
  for (const p of pairs) {
    matrix[p.expected][p.got]++;
    if (p.expected === p.got) agree++;
  }
  return { matrix, agree, total: pairs.length };
}

/** Score movement between two runs of the same texts: the mean and the worst absolute difference. */
export function stability(a: Record<string, number>, b: Record<string, number>): { mean: number | null; max: number | null; moved: { id: string; delta: number }[] } {
  const moved = Object.keys(a)
    .filter((id) => id in b)
    .map((id) => ({ id, delta: b[id]! - a[id]! }))
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  if (moved.length === 0) return { mean: null, max: null, moved };
  const abs = moved.map((m) => Math.abs(m.delta));
  return { mean: Math.round((abs.reduce((s, v) => s + v, 0) / abs.length) * 10) / 10, max: Math.max(...abs), moved };
}

/** The human's order from ranking.txt: one file name per line, best first, `#` comments and blanks ignored. */
export function parseRanking(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}
