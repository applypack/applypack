/**
 * Priority rules — opinionated post-Claude overrides on Profile. Each rule
 * says "if a job matches THIS combination of (techs ∧ regions), I want it
 * scored at least this high regardless of what Claude thinks". Used to
 * surface bare-JD postings that the user knows they want — e.g. "Senior
 * PHP backend, remote-US" with no other detail still fits if the user's
 * primary stack is PHP.
 *
 * Pure module: no DB, no HTTP. Imported by process-jobs / reclassify-job
 * and the textarea round-trip in src/text-utils-priority.ts.
 */
import { z } from 'zod';

export const PriorityRuleSchema = z.object({
  /** Short user-facing label, shown as a badge on /jobs/:id. */
  label: z.string().min(1).max(80),
  /** ≥1 of these (case-insensitive substring) must appear in title OR description. */
  techsAny: z.array(z.string().min(1)).default([]),
  /** ≥1 of these (case-insensitive substring) must appear in location. Empty = wildcard. */
  regionsAny: z.array(z.string().min(1)).default([]),
  /** Clamp fit_score up to this value if the rule matches (0-100). */
  minFitFloor: z.number().int().min(0).max(100),
});

export type PriorityRule = z.infer<typeof PriorityRuleSchema>;

export const PriorityRulesSchema = z.array(PriorityRuleSchema);

/**
 * Defensive parse for the JSON column on Profile. Returns [] for any
 * malformed shape — bad rules silently disappear rather than crashing
 * the classify pipeline.
 */
export function parsePriorityRules(raw: unknown): PriorityRule[] {
  if (raw === null || raw === undefined) return [];
  const parsed = PriorityRulesSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export interface MatchableJob {
  title: string;
  description: string;
  location: string;
}

/**
 * A rule matches a job iff:
 *   - At least one `techsAny` token appears (case-insensitive) in title OR description
 *   - AND at least one `regionsAny` token appears in location
 *     (empty regionsAny = wildcard, matches anything)
 * Empty `techsAny` is treated as an invalid rule and never matches.
 */
export function ruleMatches(rule: PriorityRule, job: MatchableJob): boolean {
  if (rule.techsAny.length === 0) return false;
  const text = `${job.title}\n${job.description}`.toLowerCase();
  const techHit = rule.techsAny.some((t) => text.includes(t.toLowerCase()));
  if (!techHit) return false;
  if (rule.regionsAny.length === 0) return true;
  const loc = job.location.toLowerCase();
  return rule.regionsAny.some((r) => loc.includes(r.toLowerCase()));
}

export interface PriorityFloorOutcome {
  applied: PriorityRule[];
  /** 0 if no rule matched. Otherwise the maximum minFitFloor across matches. */
  fitScoreFloor: number;
}

export function evaluatePriorityRules(
  rules: PriorityRule[],
  job: MatchableJob,
): PriorityFloorOutcome {
  const applied = rules.filter((r) => ruleMatches(r, job));
  const fitScoreFloor = applied.reduce(
    (max, r) => Math.max(max, r.minFitFloor),
    0,
  );
  return { applied, fitScoreFloor };
}

/**
 * Textarea round-trip format. One rule per line:
 *   LABEL | techs,csv | regions,csv | MIN_FIT
 * Example:
 *   PHP remote-US | php | US,Remote,United States,Worldwide | 90
 *
 * Lines beginning with `#` and blank lines are ignored. Tokens are
 * trimmed; empty token slots collapse to empty arrays.
 */
export function parsePriorityRulesText(input: string): {
  rules: PriorityRule[];
  errors: { line: number; raw: string; reason: string }[];
} {
  const rules: PriorityRule[] = [];
  const errors: { line: number; raw: string; reason: string }[] = [];
  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('|').map((s) => s.trim());
    if (parts.length !== 4) {
      errors.push({
        line: i + 1,
        raw: trimmed,
        reason: `expected 4 fields separated by "|", got ${parts.length}`,
      });
      continue;
    }
    const [label, techsRaw, regionsRaw, floorRaw] = parts as [
      string,
      string,
      string,
      string,
    ];
    const techsAny = splitCsv(techsRaw);
    const regionsAny = splitCsv(regionsRaw);
    const minFitFloor = Number(floorRaw);
    if (label.length === 0) {
      errors.push({ line: i + 1, raw: trimmed, reason: 'label is empty' });
      continue;
    }
    if (techsAny.length === 0) {
      errors.push({
        line: i + 1,
        raw: trimmed,
        reason: 'at least one tech is required',
      });
      continue;
    }
    if (
      !Number.isFinite(minFitFloor) ||
      minFitFloor < 0 ||
      minFitFloor > 100
    ) {
      errors.push({
        line: i + 1,
        raw: trimmed,
        reason: `min fit must be a number 0-100, got "${floorRaw}"`,
      });
      continue;
    }
    rules.push({
      label,
      techsAny,
      regionsAny,
      minFitFloor: Math.round(minFitFloor),
    });
  }
  return { rules, errors };
}

export function formatPriorityRulesText(rules: PriorityRule[]): string {
  return rules
    .map(
      (r) =>
        `${r.label} | ${r.techsAny.join(',')} | ${r.regionsAny.join(',')} | ${r.minFitFloor}`,
    )
    .join('\n');
}

function splitCsv(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
