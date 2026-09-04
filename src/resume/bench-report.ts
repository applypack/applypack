import { z } from 'zod';
import { canonicalTerm } from './facts';

/*
 * Pure side of the resume bench (src/scripts/resume-bench-once.ts). The
 * script saves one JSON record per run (engine × model × mode); this module
 * reads those records back and renders the comparison the plan asks for
 * (docs/target-plan.md §3.2 item 7, §3.4): latency per fixture, score and
 * cap, keyword count, and how often a run's keyword statuses agree with a
 * baseline run's — the number the Sonnet-vs-Opus decision rests on. No I/O.
 */

const KeywordSchema = z.object({
  term: z.string(),
  status: z.string(),
  requirement: z.string(),
  primary: z.boolean(),
});

const FixtureSchema = z.object({
  name: z.string(),
  ms: z.number(),
  /** Reply length — the output-token proxy the latency model (§2.1) rests on. */
  chars: z.number(),
  score: z.number().nullable(),
  cap: z.number().nullable(),
  keywords: z.array(KeywordSchema),
  actions: z.number(),
  removals: z.number(),
  /** v7 (ADR 0037): actions that came with paste-ready wording, and additions whose anchor line is in the resume verbatim. Absent on older runs. */
  replacements: z.number().optional(),
  anchored: z.number().optional(),
  /** Names of the checks that failed; empty when the fixture passed. */
  failed: z.array(z.string()),
});

const RunSchema = z.object({
  tag: z.string(),
  engine: z.string(),
  model: z.string(),
  mode: z.enum(['fast', 'full']),
  promptVersion: z.number().int(),
  at: z.string(),
  fixtures: z.array(FixtureSchema),
});

export type BenchKeyword = z.infer<typeof KeywordSchema>;
export type BenchFixture = z.infer<typeof FixtureSchema>;
export type BenchRun = z.infer<typeof RunSchema>;

export function readBenchRun(v: unknown): BenchRun | null {
  const r = RunSchema.safeParse(v);
  return r.success ? r.data : null;
}

export interface Agreement {
  /** Terms both runs listed (canonical spelling). */
  shared: number;
  /** Of those, how many carry the same status. */
  agree: number;
  /** Size of the union of both term lists — for the overlap ratio. */
  union: number;
}

/** Status agreement between two keyword lists, keyed by canonical term. */
export function statusAgreement(a: BenchKeyword[], b: BenchKeyword[]): Agreement {
  const byTerm = new Map(b.map((k) => [canonicalTerm(k.term), k.status]));
  const seen = new Set<string>();
  let shared = 0;
  let agree = 0;
  for (const k of a) {
    const term = canonicalTerm(k.term);
    if (seen.has(term)) continue;
    seen.add(term);
    const other = byTerm.get(term);
    if (other === undefined) continue;
    shared++;
    if (other === k.status) agree++;
  }
  const union = new Set([...seen, ...byTerm.keys()]).size;
  return { shared, agree, union };
}

/** Agreement summed over the fixtures both runs completed, matched by name. */
export function agreementWith(run: BenchRun, baseline: BenchRun): Agreement {
  const total: Agreement = { shared: 0, agree: 0, union: 0 };
  for (const f of run.fixtures) {
    const b = baseline.fixtures.find((x) => x.name === f.name);
    if (!b || f.score === null || b.score === null) continue;
    const a = statusAgreement(f.keywords, b.keywords);
    total.shared += a.shared;
    total.agree += a.agree;
    total.union += a.union;
  }
  return total;
}

/** Median; 0 for an empty list. */
export function p50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  const lo = sorted[mid - 1] ?? hi;
  return sorted.length % 2 === 1 ? hi : (lo + hi) / 2;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

/**
 * Two markdown tables: one line per run (latency, keywords, failed checks,
 * agreement with the baseline) and a fixture × run matrix of score, cap,
 * time and keyword count. The baseline is compared with itself (100%) so the
 * column reads the same on every row.
 */
export function renderBenchTable(runs: BenchRun[], baselineTag: string): string {
  const baseline = runs.find((r) => r.tag === baselineTag) ?? runs[0];
  if (!baseline) return '(no runs)';
  const lines: string[] = [];
  lines.push(`| Run | Model | Mode | Prompt | p50 | Total | Keywords | Reply chars | Actions | Replacements | Anchored | Checks failed | Status agreement vs ${baseline.tag} | Term overlap |`);
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of runs) {
    const done = r.fixtures.filter((f) => f.score !== null);
    const a = agreementWith(r, baseline);
    const failed = r.fixtures.reduce((n, f) => n + f.failed.length, 0);
    const kw = done.length === 0 ? 0 : Math.round(done.reduce((n, f) => n + f.keywords.length, 0) / done.length);
    const chars = done.length === 0 ? 0 : Math.round(done.reduce((n, f) => n + f.chars, 0) / done.length);
    const actions = done.reduce((n, f) => n + f.actions, 0);
    // Older runs carry no counters: an em dash says "not measured", never 0.
    const sum = (pick: (f: BenchFixture) => number | undefined) =>
      done.some((f) => pick(f) !== undefined) ? String(done.reduce((n, f) => n + (pick(f) ?? 0), 0)) : '—';
    lines.push(
      `| ${r.tag} | ${r.model || '(engine default)'} | ${r.mode} | v${r.promptVersion} | ${seconds(p50(r.fixtures.map((f) => f.ms)))} | ${seconds(r.fixtures.reduce((n, f) => n + f.ms, 0))} | ${kw} | ${chars} | ${actions} | ${sum((f) => f.replacements)} | ${sum((f) => f.anchored)} | ${failed} | ${pct(a.agree, a.shared)} (${a.agree}/${a.shared}) | ${pct(a.shared, a.union)} |`,
    );
  }
  lines.push('');
  lines.push(`| Fixture | ${runs.map((r) => r.tag).join(' | ')} |`);
  lines.push(`| --- | ${runs.map(() => '---').join(' | ')} |`);
  for (const name of baseline.fixtures.map((f) => f.name)) {
    const cells = runs.map((r) => {
      const f = r.fixtures.find((x) => x.name === name);
      if (!f) return '—';
      if (f.score === null) return `failed · ${seconds(f.ms)}`;
      const cap = f.cap === null ? '' : ` cap ${f.cap}`;
      const bad = f.failed.length > 0 ? ` ✗${f.failed.length}` : '';
      return `${f.score}${cap} · ${seconds(f.ms)} · ${f.keywords.length} kw${bad}`;
    });
    lines.push(`| ${name} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}
