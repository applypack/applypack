/**
 * Priority rules — opinionated post-Claude overrides on Profile. Each rule
 * says "if a job matches THIS combination of (techs ∧ regions), I want it
 * scored at least this high regardless of what Claude thinks". Used to
 * surface bare-JD postings that the user knows they want — e.g. "Senior
 * PHP backend, remote-US" with no other detail still fits if the user's
 * primary stack is PHP.
 *
 * Pure module: no DB, no HTTP. Imported by process-jobs / reclassify-job
 * and the textarea round-trip in src/web/routes/settings.tsx.
 */
import { z } from 'zod';
import type { ClaudeClassification } from './types';

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
 *   - At least one `techsAny` entry matches title OR description
 *   - AND at least one `regionsAny` entry matches location
 *     (empty regionsAny = wildcard, matches anything)
 * Empty `techsAny` is treated as an invalid rule and never matches.
 *
 * Each entry can be a single token ("php") or a multi-token phrase
 * separated by whitespace ("Remote US", "United States"). For a phrase
 * to match, EVERY token must appear in the haystack — so "Remote US"
 * does NOT match "Remote · Germany" (no "us"), avoiding the false
 * positives that bare "Remote" produces. Tokens use a word-prefix
 * boundary so "US" matches "US"/"USA"/"Remote, US" but NOT "Russia"
 * or "BUS"; "php" matches "PHP" / "PHP-FPM" but not random "graphql".
 */
export function ruleMatches(rule: PriorityRule, job: MatchableJob): boolean {
  if (rule.techsAny.length === 0) return false;
  const text = `${job.title}\n${job.description}`;
  const techHit = rule.techsAny.some((t) => phraseMatches(text, t));
  if (!techHit) return false;
  if (rule.regionsAny.length === 0) return true;
  return rule.regionsAny.some((r) => phraseMatches(job.location, r));
}

/**
 * Phrase = whitespace-separated tokens, ALL must appear with a word
 * boundary (any order, any positions). Empty phrase fails closed.
 * Exported for unit tests; consumers go through `ruleMatches`.
 */
export function phraseMatches(haystack: string, phrase: string): boolean {
  const tokens = phrase.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  return tokens.every((t) => tokenMatches(haystack, t));
}

function tokenMatches(haystack: string, token: string): boolean {
  // Word-prefix boundary: token must start at the beginning of haystack
  // or right after a non-alphanumeric char. Trailing chars are
  // unrestricted, so "us" still matches "USA" (which is usually the
  // intended behaviour) but not "BUS" or "russia".
  const re = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(token)}`,
    'i',
  );
  return re.test(haystack);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/**
 * Combines `evaluatePriorityRules` with the side-effects we want on a
 * Claude classification when a rule fires:
 *   - fit_score is clamped UP to the rule's floor (never lowered)
 *   - location_match is forced true (the user has explicitly opted into
 *     this tech×region combination, so we trust their signal over the
 *     classifier's read of an ambiguous location string)
 * Salary fields are intentionally untouched — `minSalaryUsd` remains a
 * hard floor on dismissal regardless of priority rules.
 *
 * Returns a *copy* of `c` (never mutates) so the caller can compare
 * before/after if they want telemetry.
 */
export function applyPriorityFloor(
  c: ClaudeClassification,
  rules: PriorityRule[],
  job: MatchableJob,
): { classification: ClaudeClassification; applied: PriorityRule[] } {
  const { applied, fitScoreFloor } = evaluatePriorityRules(rules, job);
  if (applied.length === 0) {
    return { classification: c, applied: [] };
  }
  return {
    classification: {
      ...c,
      fit_score: Math.max(c.fit_score, fitScoreFloor),
      location_match: true,
    },
    applied,
  };
}
