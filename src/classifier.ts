import { z } from 'zod';
import type { Profile } from '@prisma/client';
import { logger } from './logger';
import { extractJson } from './text-utils';
import { getAiRuntime } from './ai-runtime';
import { preClassify } from './classifier-prefilter';
import type { ClassifyInput, ClaudeClassification } from './types';

export type ClassifierMode = 'single' | 'two_stage';

const MAX_TOKENS = 600;
const MAX_DESC_CHARS = 4000;

const ClassificationSchema = z.object({
  fit_score: z.number().int().min(0).max(100),
  location_match: z.boolean(),
  salary_min_usd: z.number().int().nullable(),
  salary_max_usd: z.number().int().nullable(),
  tech_match: z.array(z.string()),
  red_flags: z.array(z.string()),
  summary: z.string(),
});

export interface ClassifyOutcome {
  /** Final classification, or null on classifier failure / pre-filtered out. */
  result: ClaudeClassification | null;
  /** True when stage-1 prefilter rejected — counted separately in stats. */
  preFiltered: boolean;
}

/**
 * Classify a job according to the requested classifier mode.
 *
 * - 'single': go straight to the full Haiku 4.5 classifier (current behaviour).
 * - 'two_stage': short prefilter prompt first; only proceed to the full classifier
 *   when the prefilter says the role is plausibly relevant. On a prefilter
 *   error, fail-open (run stage 2) so transient API failures don't drop
 *   real candidates.
 */
export async function classifyJob(
  input: ClassifyInput,
  profile: Profile,
  mode: ClassifierMode,
): Promise<ClassifyOutcome> {
  try {
    return await runStages(input, profile, mode);
  } catch (err) {
    // Callers queue several classifications and await them in order, so a
    // rejection here would become an unhandled rejection in the meantime.
    logger.error({ err, title: input.title }, 'classifier: unexpected failure');
    return { result: null, preFiltered: false };
  }
}

async function runStages(
  input: ClassifyInput,
  profile: Profile,
  mode: ClassifierMode,
): Promise<ClassifyOutcome> {
  if (mode === 'two_stage') {
    const pre = await preClassify(input, profile);
    if (pre && pre.relevant === false) {
      logger.debug(
        { title: input.title, reason: pre.reason },
        'classifier: stage1 not-relevant, skipping stage2',
      );
      return { result: null, preFiltered: true };
    }
    if (pre === null) {
      logger.warn(
        { title: input.title },
        'classifier: stage1 failed; falling open to stage2',
      );
    }
  }
  const result = await classifyWithClaude(input, profile);
  return { result, preFiltered: false };
}

export { decideStageStrategy } from './text-utils';

export async function classifyWithClaude(
  input: ClassifyInput,
  profile: Profile,
): Promise<ClaudeClassification | null> {
  const description = input.description.slice(0, MAX_DESC_CHARS);
  const systemPrompt = buildSystemPrompt(profile);

  const userText = [
    `Title: ${input.title}`,
    `Company: ${input.companyName}`,
    `Location: ${input.location || '(not specified)'}`,
    `Posted: ${input.postedAt.toISOString()}`,
    '',
    'Description:',
    description || '(no description)',
    '',
    'Return raw JSON only.',
  ].join('\n');

  const ai = await getAiRuntime();
  // One retry on a malformed reply: Haiku occasionally wraps or truncates JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await ai.provider.complete({
      system: systemPrompt,
      user: userText,
      maxTokens: MAX_TOKENS,
      label: 'classifier',
      model: ai.classifierModel,
    });
    if (text === null) return null;

    const json = extractJson(text);
    const parsed = json === null ? null : ClassificationSchema.safeParse(json);
    if (parsed?.success) return parsed.data;
    logger.warn(
      {
        raw: text.slice(0, 500),
        errors: parsed && !parsed.success ? parsed.error.flatten().fieldErrors : undefined,
        title: input.title,
        attempt,
      },
      'classifier: response did not match schema',
    );
  }
  return null;
}

function buildSystemPrompt(profile: Profile): string {
  const seniorityLine =
    profile.seniority.length > 0
      ? profile.seniority.join(' / ')
      : 'mid-to-senior';

  const required =
    profile.stackRequired.length > 0
      ? profile.stackRequired.join(', ')
      : '(no specific tech stack required)';
  const roleTypes =
    profile.roleTypes.length > 0
      ? profile.roleTypes.join(', ')
      : '(any role type)';
  const niceToHave =
    profile.stackNiceToHave.length > 0
      ? profile.stackNiceToHave.join(', ')
      : '(none specified)';
  const exclude =
    profile.stackExclude.length > 0
      ? profile.stackExclude.join(', ')
      : '(none)';

  const locationLine = describeLocation(profile);

  const salaryLine =
    profile.minSalaryUsd > 0
      ? `Min target salary: $${profile.minSalaryUsd.toLocaleString()} USD/year. Lower fit_score for clearly under-market roles.`
      : 'Salary is not a hard constraint, but record disclosed numbers.';

  const notesLine =
    profile.notes && profile.notes.trim().length > 0
      ? `\n\nADDITIONAL CONTEXT FROM CANDIDATE:\n${profile.notes.trim()}`
      : '';

  return `You evaluate job postings for a ${seniorityLine} software engineer with a specific candidate profile.

CANDIDATE PROFILE:
- Required TECH stack (programming languages, frameworks, runtimes — the role must ACTUALLY USE one of these): ${required}
- Acceptable role types (job category, NOT a tech match by themselves): ${roleTypes}
- Nice-to-have stack (boost fit_score when present): ${niceToHave}
- Auto-reject signals (drastically lower fit_score if these match the role): ${exclude}
- Location preferences: ${locationLine}
- ${salaryLine}${notesLine}

CRITICAL — TECH STACK MATCHING:
- A job title containing only a role-type keyword (e.g. "Full-Stack Engineer" or "Backend Engineer") is NOT a tech match if the actual stack named in the description is something different (e.g. Ruby/Rails when candidate wants PHP/Laravel).
- Read the description carefully for actual languages/frameworks. If none of the candidate's required tech is in the description, fit_score must be ≤ 35 regardless of role-type alignment.
- The title can mislead — a "Senior Full-Stack Rails Engineer" is a Rails job, not a generic full-stack match. Score it low for a PHP/JS-focused candidate.

CRITICAL — LOCATION MATCHING (SET location_match):
- "Remote, US" / "Remote, USA" / "Remote (US-based)" / "Remote · United States" / "Remote · North America" / "Remote · Americas" → location_match = true if profile includes US or Americas.
- "Remote · {Single Country}" patterns (e.g. "Remote · Germany", "Remote · UK", "Remote · India") indicate a country-locked role with local payroll/work-permit constraints. UNLESS the description explicitly opens it to other regions (e.g. "we hire globally"), location_match = FALSE for a US-based candidate. National flag emojis (🇩🇪 🇬🇧 🇮🇳) in the title are a strong country-lock signal — treat as country-locked.
- "Worldwide" or "Anywhere" or "Fully remote" with no further restriction → location_match = true if profile includes Worldwide, otherwise check if "US" is implicitly included.
- "Remote · EU only" / "EMEA only" / "APAC only" → location_match = false unless profile explicitly lists those regions.
- Hybrid / on-site roles → location_match only if the city is in profile's onsiteCities.
- When in doubt, default to location_match = false.

OUTPUT STRICT JSON ONLY (no prose, no code fences, no commentary), matching this schema exactly:

{
  "fit_score": integer 0-100,
  "location_match": boolean,
  "salary_min_usd": integer or null,
  "salary_max_usd": integer or null,
  "tech_match": string[],
  "red_flags": string[],
  "summary": string
}

SCORING GUIDANCE:
- 90-100: required stack present in title or strongly evidenced; seniority matches; location compatible with candidate's preferences; salary clear and meets target.
- 70-89: solid match with minor mismatches (some unfamiliar tech, salary not disclosed but reasonable).
- 40-69: partial match — wrong seniority, off-stack, fuzzy location policy.
- 0-39: clear miss — required stack absent, on-site only when remote needed, junior when senior needed, etc.

location_match = true ONLY when the role is open to the candidate per their location preferences above. Default to false when unclear.

tech_match: lowercase tags that intersect what the role uses with the candidate's stack (required + nice-to-have). Empty array if none match.

red_flags: short kebab-case tags such as "wordpress-only", "onsite-required-wrong-city", "junior-level", "eu-only", "uk-only", "contract-only", "low-pay", "no-salary-listed", "stack-mismatch". Empty array if none.

summary: ONE sentence (max ~25 words) explaining why it fits or does not.`;
}

function describeLocation(profile: Profile): string {
  const parts: string[] = [];
  if (profile.remoteOk) {
    if (profile.remoteRegions.length > 0) {
      parts.push(`remote OK (regions: ${profile.remoteRegions.join('/')})`);
    } else {
      parts.push('remote OK (any region)');
    }
  }
  if (profile.hybridOk) {
    parts.push('hybrid OK');
  }
  if (profile.onsiteCities.length > 0) {
    parts.push(`on-site OK in: ${profile.onsiteCities.join(', ')}`);
  }
  if (parts.length === 0) {
    return 'no preference (any location)';
  }
  return parts.join('; ');
}

