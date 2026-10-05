import { z } from 'zod';
import { PACK_STOPS, type PackStop } from './gate';
import type { TailorPolicy } from './policy';

/*
 * The dry run's report (src/scripts/pack-dry-once.ts): one record per posting
 * in, Markdown out. Pure — the script does the calling and the timing; this
 * says where the postings stopped, what each step cost in seconds, and what
 * the ones that reached the end look like. It exists to set the feature's
 * thresholds on measurements instead of guesses.
 */

const DRY_STEPS = ['liveness', 'brief', 'match', 'verify', 'tailor', 'document', 'rejudge'] as const;
export type DryStep = (typeof DRY_STEPS)[number];

const stepMs = z.number().optional();

const DryRecordSchema = z.object({
  jobId: z.number().int(),
  title: z.string(),
  company: z.string(),
  fit: z.number(),
  /** Where it stopped; null when it reached the end. `error` is a step that failed, not a verdict. */
  stop: z.enum([...PACK_STOPS, 'error']).nullable(),
  why: z.string().nullable(),
  match: z
    .object({
      score: z.number(),
      ceiling: z.number(),
      /** A stored comparison of the same text answered, so no call was made. */
      reused: z.boolean(),
      actions: z.number(),
      /** Keywords the comparison asks the person about, and ones nothing backs. */
      asks: z.number(),
      unbacked: z.number(),
    })
    .optional(),
  verify: z.object({ verdict: z.string(), recommendation: z.string(), reused: z.boolean() }).optional(),
  tailor: z
    .object({
      applied: z.number(),
      /** Operations the text could not take (a quote the resume does not carry). */
      unplaced: z.number(),
      /** Suggestions the policy left for the person. */
      held: z.number(),
      before: z.number(),
      after: z.number(),
      /** The tailored text judged again by the model, when the run asked for it. */
      rejudged: z.number().optional(),
      checks: z.array(z.string()),
      /** `own`: the person's .docx with the edits in it; `clean`: the re-set version. */
      document: z.string(),
    })
    .optional(),
  /** Milliseconds per step, for the steps that did the work (a reused result has none). */
  ms: z.object({ liveness: stepMs, brief: stepMs, match: stepMs, verify: stepMs, tailor: stepMs, document: stepMs, rejudge: stepMs }),
});
export type DryRecord = z.infer<typeof DryRecordSchema>;

/** The records an interrupted run left behind; anything that is not one is dropped, and its posting runs again. */
export function readDryRecords(v: unknown): DryRecord[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((item) => {
    const r = DryRecordSchema.safeParse(item);
    return r.success ? [r.data] : [];
  });
}

export interface DrySettings {
  minFit: number;
  minCeiling: number;
  policy: TailorPolicy;
}

const STEP_LABEL: Record<DryStep, string> = {
  liveness: 'Still open? (no AI)',
  brief: 'Read the posting',
  match: 'Compare',
  verify: 'Check the company (web)',
  tailor: 'Apply the edits (no AI)',
  document: 'Draw the file (no AI)',
  rejudge: 'Judge the tailored text again',
};

const STOP_LABEL: Record<PackStop | 'error', string> = {
  closed: 'closed',
  'failed-gate': 'failed a requirement',
  'low-ceiling': 'under the ceiling floor',
  fake: 'fake',
  skip: 'not worth applying',
  error: 'a step failed',
};

/** Nearest rank, so a percentile is always one of the measurements. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? null;
}

const seconds = (ms: number | null): string => (ms === null ? '—' : `${Math.round(ms / 1000)} s`);
const total = (r: DryRecord): number => DRY_STEPS.reduce((sum, step) => sum + (r.ms[step] ?? 0), 0);
/** A table cell: one line, no column breaks, short enough to scan. */
const cell = (s: string, max = 160): string => {
  const flat = s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const posting = (r: DryRecord): string => cell(`${r.jobId} · ${r.title} · ${r.company}`, 90);

function stopped(records: DryRecord[], ...stops: (PackStop | 'error')[]): string {
  const parts = stops
    .map((s) => [s, records.filter((r) => r.stop === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${STOP_LABEL[s]}`);
  return parts.length > 0 ? parts.join(', ') : '—';
}

export function dryReport(records: DryRecord[], settings: DrySettings): string {
  const { policy } = settings;
  const ready = records.filter((r) => r.stop === null);
  const compared = records.filter((r) => r.match);
  const verified = records.filter((r) => r.verify);
  const tailored = records.filter((r) => r.tailor);
  const out: string[] = [
    '# Application pack — dry run',
    '',
    `${records.length} postings with fit ≥ ${settings.minFit} · ceiling floor ${settings.minCeiling} · ` +
      `edits in ${policy.sections.join(', ')} · ${policy.maxBullets} bullets at most · ` +
      `${policy.removals ? 'removals on' : 'nothing removed'} · ${policy.keywords ? 'backed keywords written in' : 'keywords left alone'}`,
    '',
    `**Ready: ${ready.length} of ${records.length}.**`,
    '',
    '## Where they stopped',
    '',
    '| Step | Reached it | Stopped there |',
    '| --- | --- | --- |',
    `| Still open? | ${records.length} | ${stopped(records, 'closed')} |`,
    `| Compared with the resume | ${compared.length} | ${stopped(records, 'failed-gate', 'low-ceiling')} |`,
    `| Company checked | ${verified.length} | ${stopped(records, 'fake', 'skip')} |`,
    `| Resume tailored | ${tailored.length} | — |`,
    '',
  ];
  const errors = records.filter((r) => r.stop === 'error');
  if (errors.length > 0) out.push(`A step failed on ${errors.length}: they are listed under Stopped and run again on the next start.`, '');

  out.push('## Time per step', '', '| Step | Runs | Median | 90th percentile |', '| --- | --- | --- | --- |');
  for (const step of DRY_STEPS) {
    const times = records.flatMap((r) => r.ms[step] ?? []);
    if (times.length > 0) out.push(`| ${STEP_LABEL[step]} | ${times.length} | ${seconds(percentile(times, 50))} | ${seconds(percentile(times, 90))} |`);
  }
  const whole = ready.filter((r) => !r.match?.reused && !r.verify?.reused).map(total);
  if (whole.length > 0) {
    out.push('', `A whole pack with nothing reused: median ${seconds(percentile(whole, 50))}, 90th percentile ${seconds(percentile(whole, 90))} (${whole.length} runs).`);
  }

  if (ready.length > 0) {
    const lifts = ready.flatMap((r) => (r.tailor ? [r.tailor.after - r.tailor.before] : []));
    out.push(
      '',
      '## Ready',
      '',
      `Median lift from the edits: +${percentile(lifts, 50) ?? 0} points (the alignment grades are held still, so this is a floor).`,
      '',
      '| Posting | Fit | Match | Company | Edits | Left for you | Checks | File |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const r of ready) {
      const t = r.tailor;
      const m = r.match;
      const match = t && m ? `${t.before} → ${t.after}${t.rejudged === undefined ? '' : ` (judged again: ${t.rejudged})`} · ceiling ${m.ceiling}` : '—';
      const company = r.verify ? `${r.verify.verdict} · ${r.verify.recommendation}` : 'not checked';
      const edits = t ? `${t.applied} applied${t.unplaced > 0 ? `, ${t.unplaced} unplaced` : ''}` : '—';
      const left = t && m ? `${t.held} held, ${m.asks} to ask, ${m.unbacked} unbacked` : '—';
      out.push(`| ${posting(r)} | ${r.fit} | ${match} | ${company} | ${edits} | ${left} | ${t && t.checks.length > 0 ? t.checks.join(', ') : 'ok'} | ${t?.document ?? '—'} |`);
    }
  }

  const stops = records.filter((r) => r.stop !== null);
  if (stops.length > 0) {
    out.push('', '## Stopped', '', '| Posting | Fit | Match | Stop | Why |', '| --- | --- | --- | --- | --- |');
    for (const r of stops) {
      const match = r.match ? `${r.match.score} · ceiling ${r.match.ceiling}` : '—';
      out.push(`| ${posting(r)} | ${r.fit} | ${match} | ${STOP_LABEL[r.stop ?? 'error']} | ${cell(r.why ?? '')} |`);
    }
  }
  return `${out.join('\n')}\n`;
}
