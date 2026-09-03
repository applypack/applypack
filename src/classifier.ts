import { z } from 'zod';
import type { Profile } from '@prisma/client';
import { logger } from './logger';
import { extractJson } from './text-utils';
import { getAiRuntime } from './ai-runtime';
import { preClassify } from './classifier-prefilter';
import { capFitForMissingStack } from './profile-guards';
import { INJECTION_FLAG, fence, untrustedDirective } from './prompt-fence';
import type { ClassifyInput, ClaudeClassification } from './types';

export type ClassifierMode = 'single' | 'two_stage';

// One reply carries every search's verdict, so the ceiling has to grow with
// the number of searches. Measured (ADR 0028): a posting costs ~90 + 100·N
// output tokens, and 400 + 180·N left headroom at every N through 12.
const BASE_MAX_TOKENS = 400;
const MAX_TOKENS_PER_PROFILE = 180;
const MAX_DESC_CHARS = 4000;
// Bump on any material change to buildClassifyPrompt (rules, rubric, format,
// fencing) — cross-engine quality comparisons are meaningless across versions.
// v3: one call scores every active search (ADR 0028).
export const CLASSIFIER_PROMPT_VERSION = 3;

/**
 * Salary is hoisted out of the per-search entries on purpose: it is a fact of
 * the posting, not of a search, and asking for it N times invites two searches
 * to report different numbers for one job.
 */
const MultiClassificationSchema = z.object({
  salary_min_usd: z.number().int().nullable(),
  salary_max_usd: z.number().int().nullable(),
  scores: z
    .array(
      z.object({
        profile_id: z.number().int(),
        fit_score: z.number().int().min(0).max(100),
        location_match: z.boolean(),
        tech_match: z.array(z.string()),
        red_flags: z.array(z.string()),
        summary: z.string(),
      }),
    )
    .min(1),
});

/** One verdict per active search, keyed by profile id. */
export type ClassificationsByProfile = Map<number, ClaudeClassification>;

export interface ClassifyOutcome {
  /** Empty on classifier failure or when stage 1 filtered the posting out. */
  results: ClassificationsByProfile;
  /** True when stage-1 prefilter rejected — counted separately in stats. */
  preFiltered: boolean;
}

const EMPTY: ClassifyOutcome = { results: new Map(), preFiltered: false };

/**
 * Score one posting against every active search in a single call (ADR 0028).
 *
 * - 'single': go straight to the full classifier (current behaviour).
 * - 'two_stage': short union prefilter first; only proceed when at least one
 *   search could plausibly want the role. On a prefilter error, fail-open (run
 *   stage 2) so transient API failures don't drop real candidates.
 */
export async function classifyJob(
  input: ClassifyInput,
  profiles: Profile[],
  mode: ClassifierMode,
): Promise<ClassifyOutcome> {
  try {
    return await runStages(input, profiles, mode);
  } catch (err) {
    // Callers queue several classifications and await them in order, so a
    // rejection here would become an unhandled rejection in the meantime.
    logger.error({ err, title: input.title }, 'classifier: unexpected failure');
    return EMPTY;
  }
}

async function runStages(
  input: ClassifyInput,
  profiles: Profile[],
  mode: ClassifierMode,
): Promise<ClassifyOutcome> {
  if (profiles.length === 0) return EMPTY;
  if (mode === 'two_stage') {
    const pre = await preClassify(input, profiles);
    if (pre && pre.relevant === false) {
      logger.debug(
        { title: input.title, reason: pre.reason },
        'classifier: stage1 not-relevant, skipping stage2',
      );
      return { results: new Map(), preFiltered: true };
    }
    if (pre === null) {
      logger.warn(
        { title: input.title },
        'classifier: stage1 failed; falling open to stage2',
      );
    }
  }
  return { results: await classifyWithClaude(input, profiles), preFiltered: false };
}

export { decideStageStrategy } from './text-utils';

/** System + user for one classification. Pure — the only untested seam left is the call. */
export function buildClassifyPrompt(
  input: ClassifyInput,
  profiles: Profile[],
): { system: string; user: string } {
  return {
    system: buildSystemPrompt(profiles),
    user: [
      `Posted: ${input.postedAt.toISOString()}`,
      '',
      fence(
        'JOB POSTING',
        [
          `Title: ${input.title}`,
          `Company: ${input.companyName}`,
          `Location: ${input.location || '(not specified)'}`,
          '',
          'Description:',
          input.description.slice(0, MAX_DESC_CHARS) || '(no description)',
        ].join('\n'),
      ),
      '',
      'Return raw JSON only.',
    ].join('\n'),
  };
}

/**
 * Turn one reply into a verdict per search. Pure, so the shape contract is
 * unit-tested without an engine.
 *
 * A reply is rejected outright when it names a search we did not ask about or
 * repeats one — both mean the model lost track of the roster, and a partial
 * answer accepted here would silently become a stored score. Missing entries
 * are a softer failure: what came back is kept, and the searches that got no
 * verdict simply stay unscored, exactly as a failed call would leave them.
 */
export function parseClassifications(
  text: string,
  profiles: Profile[],
): ClassificationsByProfile | null {
  const json = extractJson(text);
  if (json === null) return null;
  const parsed = MultiClassificationSchema.safeParse(json);
  if (!parsed.success) return null;

  const wanted = new Map(profiles.map((p) => [p.id, p]));
  const out: ClassificationsByProfile = new Map();
  for (const entry of parsed.data.scores) {
    const profile = wanted.get(entry.profile_id);
    if (!profile || out.has(entry.profile_id)) return null;
    // The prompt's stack-mismatch cap is vacuous without a required stack
    // (issue #50), so the cap is enforced in code — gotcha 11.
    out.set(
      entry.profile_id,
      capFitForMissingStack(
        {
          fit_score: entry.fit_score,
          location_match: entry.location_match,
          salary_min_usd: parsed.data.salary_min_usd,
          salary_max_usd: parsed.data.salary_max_usd,
          tech_match: entry.tech_match,
          red_flags: entry.red_flags,
          summary: entry.summary,
        },
        profile,
      ),
    );
  }
  return out.size > 0 ? out : null;
}

export async function classifyWithClaude(
  input: ClassifyInput,
  profiles: Profile[],
): Promise<ClassificationsByProfile> {
  const { system: systemPrompt, user: userText } = buildClassifyPrompt(input, profiles);

  const ai = await getAiRuntime();
  // One retry on a malformed reply: small models occasionally wrap or truncate JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await ai.complete({
      system: systemPrompt,
      user: userText,
      maxTokens: BASE_MAX_TOKENS + MAX_TOKENS_PER_PROFILE * profiles.length,
      label: 'classifier',
      role: 'classifier',
    });
    if (out === null) return new Map();

    const parsed = parseClassifications(out.text, profiles);
    if (parsed) {
      if (parsed.size < profiles.length) {
        logger.warn(
          { title: input.title, got: parsed.size, want: profiles.length },
          'classifier: reply skipped some searches; they stay unscored',
        );
      }
      return parsed;
    }
    logger.warn(
      {
        raw: out.text.slice(0, 500),
        title: input.title,
        profiles: profiles.length,
        attempt,
        engine: out.providerId,
        promptVersion: CLASSIFIER_PROMPT_VERSION,
      },
      'classifier: response did not match schema',
    );
  }
  return new Map();
}

/** One block per search — the only part of the prompt that repeats. */
function describeProfile(profile: Profile): string {
  const seniority =
    profile.seniority.length > 0 ? profile.seniority.join(' / ') : 'mid-to-senior';
  const list = (values: string[], empty: string) =>
    values.length > 0 ? values.join(', ') : empty;
  const salaryLine =
    profile.minSalaryUsd > 0
      ? `Min target salary: $${profile.minSalaryUsd.toLocaleString()} USD/year — lower fit_score for clearly under-market roles.`
      : 'Salary is not a hard constraint for this search.';
  // Operator text (Profile.notes) stays outside every fence — it is the user's
  // own instruction channel, tier 3 in ADR 0022.
  const notesLine =
    profile.notes && profile.notes.trim().length > 0
      ? `\n- Context from the candidate: ${profile.notes.trim()}`
      : '';

  return `SEARCH ${profile.id} — "${profile.name}"
- Seniority: ${seniority}
- Required TECH stack (programming languages, frameworks, runtimes — the role must ACTUALLY USE one of these): ${list(profile.stackRequired, '(none specified)')}
- Acceptable role types (job category, NOT a tech match by themselves): ${list(profile.roleTypes, '(any role type)')}
- Nice-to-have stack (boost fit_score when present): ${list(profile.stackNiceToHave, '(none specified)')}
- Auto-reject signals (drastically lower fit_score if these match the role): ${list(profile.stackExclude, '(none)')}
- Location preferences: ${describeLocation(profile)}
- ${salaryLine}${notesLine}`;
}

function buildSystemPrompt(profiles: Profile[]): string {
  const ids = profiles.map((p) => p.id).join(', ');
  const many = profiles.length > 1;

  return `You evaluate ONE job posting against ${profiles.length} independent candidate ${many ? 'searches' : 'search'}. Judge each search SEPARATELY — the same posting can be a perfect fit for one and a clear miss for another. Never average them, and never let a strong match in one search lift another.

${untrustedDirective('red_flags')}

${profiles.map(describeProfile).join('\n\n')}

CRITICAL — TECH STACK MATCHING (applies to every search on its own):
- A job title containing only a role-type keyword (e.g. "Full-Stack Engineer" or "Backend Engineer") is NOT a tech match if the actual stack named in the description is something different (e.g. Ruby/Rails when the search wants PHP/Laravel).
- Read the description carefully for actual languages/frameworks. If none of a search's required tech is in the description, THAT search's fit_score must be ≤ 35 regardless of role-type alignment.
- The title can mislead — a "Senior Full-Stack Rails Engineer" is a Rails job, not a generic full-stack match. Score it low for a PHP/JS-focused search.

CRITICAL — LOCATION MATCHING (per search, SET location_match):
- "Remote, US" / "Remote, USA" / "Remote (US-based)" / "Remote · United States" / "Remote · North America" / "Remote · Americas" → location_match = true if that search includes US or Americas.
- "Remote · {Single Country}" patterns (e.g. "Remote · Germany", "Remote · UK", "Remote · India") indicate a country-locked role with local payroll/work-permit constraints. UNLESS the description explicitly opens it to other regions (e.g. "we hire globally"), location_match = FALSE for a US-based search. National flag emojis (🇩🇪 🇬🇧 🇮🇳) in the title are a strong country-lock signal — treat as country-locked.
- "Worldwide" or "Anywhere" or "Fully remote" with no further restriction → location_match = true if that search includes Worldwide, otherwise check if "US" is implicitly included.
- "Remote · EU only" / "EMEA only" / "APAC only" → location_match = false unless that search explicitly lists those regions.
- Hybrid / on-site roles → location_match only if the city is in that search's on-site list.
- When in doubt, default to location_match = false.

OUTPUT STRICT JSON ONLY (no prose, no code fences, no commentary), matching this schema exactly:

{
  "salary_min_usd": integer or null,
  "salary_max_usd": integer or null,
  "scores": [
    {
      "profile_id": integer,
      "fit_score": integer 0-100,
      "location_match": boolean,
      "tech_match": string[],
      "red_flags": string[],
      "summary": string
    }
  ]
}

"scores" MUST hold EXACTLY ${profiles.length} ${many ? 'entries' : 'entry'} — one per search — using ${many ? 'these ids and no others' : 'this id and no other'}: ${ids}.

Salary belongs to the posting, not to a search: read it once from the description and report it at the top level, null when it is not disclosed.

SCORING GUIDANCE (apply per search):
- 90-100: that search's required stack present in title or strongly evidenced; seniority matches; location compatible with that search's preferences; salary clear and meets target.
- 70-89: solid match with minor mismatches (some unfamiliar tech, salary not disclosed but reasonable).
- 40-69: partial match — wrong seniority, off-stack, fuzzy location policy.
- 0-39: clear miss — required stack absent, on-site only when remote needed, junior when senior needed, etc.

location_match = true ONLY when the role is open to that search's candidate per its location preferences above. Default to false when unclear.

tech_match: lowercase tags that intersect what the role uses with THAT search's stack (required + nice-to-have). Empty array if none match.

red_flags: short kebab-case tags such as "wordpress-only", "onsite-required-wrong-city", "junior-level", "eu-only", "uk-only", "contract-only", "low-pay", "no-salary-listed", "stack-mismatch", "${INJECTION_FLAG}". Empty array if none.

summary: ONE sentence (max ~25 words) explaining why the posting fits that search or does not.`;
}

/**
 * Codes, not names — eight searches must stay short (ADR 0032). "remote
 * from: PL, DE, EU; hybrid / on-site in: Warsaw" is what the rules below
 * refer to as "that search's countries / regions / cities".
 */
function describeLocation(profile: Profile): string {
  const places = [...profile.countries, ...profile.regions];
  const where = places.length > 0 ? places.join(', ') : 'anywhere';
  const accepts = profile.workplace.length > 0 ? profile.workplace : ['REMOTE', 'HYBRID', 'ONSITE'];
  const parts: string[] = [];
  if (accepts.includes('REMOTE')) parts.push(`remote from: ${where}`);
  const office = accepts.filter((w) => w !== 'REMOTE').map((w) => w.toLowerCase().replace('onsite', 'on-site'));
  if (office.length > 0) {
    const cities = profile.onsiteCities.length > 0 ? profile.onsiteCities.join(', ') : where;
    parts.push(`${office.join(' / ')} in: ${cities}`);
  }
  return parts.join('; ');
}
