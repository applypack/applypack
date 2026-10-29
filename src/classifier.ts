import { z } from 'zod';
import type { Profile } from '@prisma/client';
import { currencyOf, isCurrencyCode, isSalaryPeriod } from './currency';
import { RELOCATION_PROMPT, isRelocation } from './eligibility';
import { logger } from './logger';
import { extractJson } from './text-utils';
import { getAiRuntime, type AiRuntime } from './ai-runtime';
import type { AiProviderId } from './ai-engine';
import { preClassify, prefilterMayJudge } from './classifier-prefilter';
import { capFitForMissingStack } from './profile-guards';
import { LEVELS, OFF_STACK, ROLE_FITS, STACK_ROLES, anchorFitFacts, fitFromFacts, techTags } from './fit-score';
import { isCountryCode, isRegionCode, REGIONS } from './countries';
import { arrangementOnly } from './location';
import { INJECTION_FLAG, fence, untrustedDirective } from './prompt-fence';
import type { ClassifyInput, ClaudeClassification } from './types';

export type ClassifierMode = 'single' | 'two_stage';

// One reply carries every search's verdict, so the ceiling has to grow with
// the number of searches. Measured (ADR 0028): a posting cost ~90 + 100·N
// output tokens, and 400 + 180·N left headroom at every N through 12. The
// facts of ADR 0064 name the search's own items: one search's reply measured
// 322 tokens on average and 672 at most (2026-10-29), so a search gets more.
const BASE_MAX_TOKENS = 400;
const MAX_TOKENS_PER_PROFILE = 320;
const MAX_DESC_CHARS = 4000;
// Bump on any material change to buildClassifyPrompt (rules, rubric, format,
// fencing) — cross-engine quality comparisons are meaningless across versions.
// v3: one call scores every active search (ADR 0028).
// v5: a bare "Remote" is decided in code — unknown, not a mismatch (#386).
// v6: each search names the groups that hold its countries (#530).
// v7: facts per search instead of a fit score; code computes it (ADR 0064).
const CLASSIFIER_PROMPT_VERSION = 7;
// The parsed line's words for a bare "Remote"; the location rules quote them.
const NO_PLACE_NAMED = 'no country named';
// #386: left to the rules, one posting scored 92 nine times and 45 once on a
// bare "Remote", and the model called it a mismatch whenever the stack failed
// too (measured) — so the parsed line decides it, per posting.
const BARE_REMOTE_LINE = `${NO_PLACE_NAMED} — decided: location_match true for every search that accepts remote, whatever its stack or seniority verdict, unless the description overrides it`;

/**
 * Salary is hoisted out of the per-search entries on purpose: it is a fact of
 * the posting, not of a search, and asking for it N times invites two searches
 * to report different numbers for one job.
 */
/**
 * ADR 0032: the posting's own place, read once and shared like salary. Codes
 * the gazetteer does not know are dropped rather than failing the reply;
 * the block is optional so an engine that omits it still yields verdicts.
 */
const LocationBlockSchema = z
  .object({
    workplace: z
      .preprocess((v) => (typeof v === 'string' ? v.toUpperCase() : v), z.enum(['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN']))
      .catch('UNKNOWN'),
    countries: z.array(z.string()).catch([]),
    regions: z.array(z.string()).catch([]),
    note: z.string().nullable().catch(null),
  })
  .transform((b) => ({
    workplace: b.workplace,
    countries: unique(b.countries.map((c) => c.toUpperCase()).filter(isCountryCode)),
    regions: unique(b.regions.map((r) => r.toUpperCase()).filter(isRegionCode)),
    note: b.note && b.note.trim().length > 0 ? b.note.trim() : null,
  }));

export type AiLocation = z.infer<typeof LocationBlockSchema>;

/** A graded fact: one of its words, whatever the case the model wrote it in. */
const grade = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(values));

const MultiClassificationSchema = z.object({
  // The posting's own numbers — the model reports, src/currency.ts converts.
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  salary_currency: z.string().nullable().optional(),
  salary_period: z.string().nullable().optional(),
  location: LocationBlockSchema.optional(),
  // ADR 0064: the posting's level, read once like salary; fit-score.ts compares it with each search's.
  levels: z.array(z.string()),
  min_years: z.number().nullable(),
  scores: z
    .array(
      z.object({
        profile_id: z.number().int(),
        // ADR 0064: what the posting shows; fit-score.ts makes the number.
        stack_used: z.array(z.string()),
        stack_role: grade(STACK_ROLES),
        role_types: z.array(z.string()),
        role_type: grade(ROLE_FITS),
        nice_used: z.array(z.string()),
        excluded: z.array(z.string()),
        off_stack: grade(OFF_STACK),
        location_match: z.boolean(),
        red_flags: z.array(z.string()),
        summary: z.string(),
      }),
    )
    .min(1),
});

/** One verdict per active search, keyed by profile id. */
export type ClassificationsByProfile = Map<number, ClaudeClassification>;

/** What one reply says: a verdict per search, and the posting's place (ADR 0032). */
export interface Classifications {
  results: ClassificationsByProfile;
  location: AiLocation | null;
}

export interface ClassifyOutcome extends Classifications {
  /** True when stage-1 prefilter rejected — counted separately in stats. */
  preFiltered: boolean;
  /** The prefilter's own one-line reason, when it rejected. */
  prefilterReason?: string;
  /** The ledger rows the scoring wrote: a posting the tick stores afterwards is named on them (#483). */
  ledgerIds: number[];
}

const EMPTY: ClassifyOutcome = { results: new Map(), location: null, preFiltered: false, ledgerIds: [] };

/**
 * One posting's scoring as the ledger sees it: the runtime both stages ask,
 * the stored row the calls are for when there is one, and the rows the calls
 * wrote, gathered as they answer.
 */
export interface ScoringCall {
  ai: Pick<AiRuntime, 'complete' | 'unparsed'>;
  subject?: { jobId: number };
  ledgerIds: number[];
}

interface ClassifyOptions {
  /** The posting's row, when it is stored before it is scored (a re-classify): the ledger names it at once. */
  jobId?: number;
  /** The last engine's one-line reason when no engine answered. */
  onError?: (reason: string) => void;
  /** A test hands its own runtime; everyone else asks the one the settings make. */
  ai?: Pick<AiRuntime, 'complete' | 'unparsed'>;
}

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
  opts: ClassifyOptions = {},
): Promise<ClassifyOutcome> {
  try {
    return await runStages(input, profiles, mode, opts);
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
  opts: ClassifyOptions,
): Promise<ClassifyOutcome> {
  if (profiles.length === 0) return EMPTY;
  const call: ScoringCall = {
    ai: opts.ai ?? (await getAiRuntime()),
    subject: opts.jobId === undefined ? undefined : { jobId: opts.jobId },
    ledgerIds: [],
  };
  if (mode === 'two_stage' && prefilterMayJudge(input, profiles)) {
    const pre = await preClassify(input, profiles, call);
    if (pre && pre.relevant === false) {
      logger.debug(
        { title: input.title, reason: pre.reason },
        'classifier: stage1 not-relevant, skipping stage2',
      );
      return { results: new Map(), location: null, preFiltered: true, prefilterReason: pre.reason, ledgerIds: call.ledgerIds };
    }
    if (pre === null) {
      logger.warn(
        { title: input.title },
        'classifier: stage1 failed; falling open to stage2',
      );
    }
  }
  return { ...(await classifyWithClaude(input, profiles, call, opts.onError)), preFiltered: false, ledgerIds: call.ledgerIds };
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

export { decideStageStrategy } from './text-utils';

/** The reply's ceiling for one posting scored against `searches` searches at once. */
function classifyMaxTokens(searches: number): number {
  return BASE_MAX_TOKENS + MAX_TOKENS_PER_PROFILE * searches;
}

/** System + user for one classification. Pure — the only untested seam left is the call. */
export function buildClassifyPrompt(
  input: ClassifyInput,
  profiles: Profile[],
): { system: string; user: string } {
  const place = input.place;
  const bareRemote =
    place?.workplace === 'REMOTE' &&
    place.countries.length === 0 &&
    place.regions.length === 0 &&
    arrangementOnly(input.location);
  const parsedLine = place
    ? `Location as parsed from the source: ${place.workplace}${
        place.countries.length > 0 ? ` · countries ${place.countries.join(', ')}` : ''
      }${place.regions.length > 0 ? ` · regions ${place.regions.join(', ')}` : ''}${bareRemote ? ` · ${BARE_REMOTE_LINE}` : ''}`
    : null;
  return {
    system: buildSystemPrompt(profiles),
    user: [
      `Posted: ${input.postedAt.toISOString()}`,
      ...(parsedLine ? [parsedLine] : []),
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
): Classifications | null {
  const json = extractJson(text);
  if (json === null) return null;
  const parsed = MultiClassificationSchema.safeParse(json);
  if (!parsed.success) return null;

  const wanted = new Map(profiles.map((p) => [p.id, p]));
  const salary = {
    salary_min: parsed.data.salary_min,
    salary_max: parsed.data.salary_max,
    salary_currency: isCurrencyCode(parsed.data.salary_currency) ? currencyOf(parsed.data.salary_currency) : null,
    salary_period: isSalaryPeriod(parsed.data.salary_period) ? parsed.data.salary_period : null,
  };
  const out: ClassificationsByProfile = new Map();
  for (const entry of parsed.data.scores) {
    const profile = wanted.get(entry.profile_id);
    if (!profile || out.has(entry.profile_id)) return null;
    // The model reports facts and the number is arithmetic (ADR 0064); the
    // tags the stack facets read are the same facts, so the two cannot disagree.
    const facts = anchorFitFacts(entry, parsed.data, profile);
    // The stack rules are vacuous without a required stack (issue #50), so
    // the blank-search cap is enforced in code too — gotcha 11.
    out.set(
      entry.profile_id,
      capFitForMissingStack(
        {
          fit_score: fitFromFacts(facts, profile, salary),
          fit_facts: facts,
          location_match: entry.location_match,
          ...salary,
          tech_match: techTags(facts),
          red_flags: entry.red_flags,
          summary: entry.summary,
        },
        profile,
      ),
    );
  }
  return out.size > 0 ? { results: out, location: parsed.data.location ?? null } : null;
}

async function classifyWithClaude(
  input: ClassifyInput,
  profiles: Profile[],
  call: ScoringCall,
  onError?: (reason: string) => void,
): Promise<Classifications> {
  const { system: systemPrompt, user: userText } = buildClassifyPrompt(input, profiles);

  // One retry on a malformed reply: small models occasionally wrap or truncate JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await call.ai.complete({
      json: true,
      system: systemPrompt,
      user: userText,
      maxTokens: classifyMaxTokens(profiles.length),
      label: 'classifier',
      role: 'classifier',
      subject: call.subject,
      onError,
    });
    if (out === null) return { results: new Map(), location: null };
    call.ledgerIds.push(...out.ledgerIds);

    const parsed = parseClassifications(out.text, profiles);
    if (parsed) {
      logger.debug(
        { jobId: call.subject?.jobId, title: input.title, verdicts: [...parsed.results].map(([search, c]) => ({ search, fit: c.fit_score, facts: c.fit_facts })) },
        'classifier: fit from facts',
      );
      if (parsed.results.size < profiles.length) {
        logger.warn(
          { title: input.title, got: parsed.results.size, want: profiles.length },
          'classifier: reply skipped some searches; they stay unscored',
        );
      }
      return parsed;
    }
    await call.ai.unparsed(out);
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
  return { results: new Map(), location: null };
}

/**
 * One reading on one engine, as the engine trial takes it (#412): the tick's
 * prompt, no retry and no fallback — a reply that is no score is part of what
 * the trial measures. Null when the engine did not answer; `parsed` is null
 * when it answered with something that is no score.
 */
export async function classifyOnEngine(
  input: ClassifyInput,
  profiles: Profile[],
  engine: AiProviderId,
  onError?: (reason: string) => void,
): Promise<{ parsed: Classifications | null } | null> {
  const ai = await getAiRuntime();
  const out = await ai.complete({
    ...buildClassifyPrompt(input, profiles),
    json: true,
    maxTokens: classifyMaxTokens(profiles.length),
    label: 'engine-trial',
    role: 'classifier',
    engine,
    onError,
  });
  return out && { parsed: parseClassifications(out.text, profiles) };
}

/** One block per search — the only part of the prompt that repeats. */
function describeProfile(profile: Profile): string {
  const seniority =
    profile.seniority.length > 0 ? profile.seniority.join(' / ') : 'mid-to-senior';
  const list = (values: string[], empty: string) =>
    values.length > 0 ? values.join(', ') : empty;
  const salaryLine =
    profile.minSalaryUsd > 0
      ? `Min target salary: $${profile.minSalaryUsd.toLocaleString()} USD/year.`
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
- Nice-to-have stack: ${list(profile.stackNiceToHave, '(none specified)')}
- Auto-reject signals: ${list(profile.stackExclude, '(none)')}
- Location preferences: ${describeLocation(profile)}${describeGroups(profile)}${describeEligibility(profile)}
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
- Read the description for the languages and frameworks actually used: a role-type keyword alone never puts anything in stack_used.
- The title can mislead — a "Senior Full-Stack Rails Engineer" is a Rails job, not a generic full-stack match: stack_role "none" for a PHP/JS-focused search.

CRITICAL — LOCATION MATCHING (per search, SET location_match):
Each search says where it hunts as codes: ISO countries (PL, DE, US, GB) and groups — EU = the 27 member states; EUROPE = the continent, which also holds GB, CH, NO, UA; EMEA; AMERICAS; NORTH_AMERICA; LATAM; APAC; DACH; NORDICS; BENELUX; CEE; WORLDWIDE = anywhere — plus the arrangements it accepts. A search that lists no countries and no regions accepts any place.
- Read the location line AND the description: residency, work-permit, payroll, contract-type and time-zone sentences override the location line. "Location as parsed from the source" is a starting point, not a verdict.
- Country-locked remote ("Remote · Germany", "must reside in Poland", a national flag, local-payroll wording) → true only for a search that lists that country or a group containing it.
- Region-locked remote ("EU only", "Europe", "EMEA", "US time zones") → true only for a search that lists that region, a country inside it, or WORLDWIDE; "Its countries lie inside" names those regions for each search. EU is law and EUROPE is geography: an EU work-right requirement fails a GB or UA search even when that search lists EUROPE.
- Worldwide / "anywhere" / "we hire globally" with no restriction → true for every search that accepts remote.
- Parsed "${NO_PLACE_NAMED}" (a bare "Remote") is not doubt: true for every search accepting remote unless the description overrides it; the summary says "country unconfirmed".
- Hybrid / on-site roles → true only for a search that accepts that arrangement AND lists the office's city, its country, or a group containing it (a listed city adds to the countries, it never narrows them). Never infer remote eligibility from an office address.
- Several offices or arrangements → judge by the softest one named.
- When in doubt, default to location_match = false.

ELIGIBILITY (only for a search that says where the candidate lives):
- Its countries are where it WANTS to work; "lives in" is where it may work today. A posting closed to that country matches only if the posting opens it — relocation, sponsorship, an employer of record, or B2B abroad.
- "Right to work in X required" / "no visa sponsorship", candidate outside X → false, flag "work-permit-required", or "no-visa-sponsorship" when the search needs sponsorship the posting refuses.
- "will not relocate": hybrid / on-site outside that country is false. "would relocate": an on-site role offering relocation matches, with sponsorship when the search needs it.
- Silence is not a refusal: no permit wording keeps the verdict above.

OUTPUT STRICT JSON ONLY (no prose, no code fences, no commentary), matching this schema exactly:

{
  "salary_min": integer or null — the posting's own number,
  "salary_max": integer or null,
  "salary_currency": ISO-4217 ("USD", "EUR", "PLN") or null,
  "salary_period": "year" | "month" | "week" | "day" | "hour" or null,
  "levels": the seniority levels the posting names for the role — ${LEVELS.map((l) => `"${l}"`).join(' | ')} ("Regular" is mid; a title and a level line can name two) — or [],
  "min_years": the fewest years of experience it asks for, or null,
  "location": {
    "workplace": "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN",
    "countries": ISO-2 codes — where the candidate may live for a remote role, where the office is otherwise,
    "regions": group codes the posting names (EU, EUROPE, EMEA, WORLDWIDE, AMERICAS, NORTH_AMERICA, LATAM, APAC, DACH, NORDICS, BENELUX, CEE),
    "note": the sentence that decided it, at most 15 words, or null
  },
  "scores": [
    {
      "profile_id": integer,
      "stack_used": string[],
      "stack_role": "core" | "secondary" | "none",
      "role_types": string[],
      "role_type": "match" | "adjacent" | "other",
      "nice_used": string[],
      "excluded": string[],
      "off_stack": "none" | "some" | "most",
      "location_match": boolean,
      "red_flags": string[],
      "summary": string
    }
  ]
}

"scores" MUST hold EXACTLY ${profiles.length} ${many ? 'entries' : 'entry'} — one per search — using ${many ? 'these ids and no others' : 'this id and no other'}: ${ids}.

Salary, location and level belong to the posting, not to a search: read each once and report it at the top level — salary null when not disclosed, location with empty arrays and "UNKNOWN" when the posting names no place. Report salary EXACTLY as the posting states it — its own numbers, currency and period ("20 200 - 27 600 PLN/month" → 20200, 27600, "PLN", "month"). Never convert or annualise: that is what the two extra fields are for.

FACTS (per search). Report what the posting shows, each fact on its own: the role type never empties the stack facts, and the fit score is computed from them, so never shade one fact to make up for another.
- stack_used: every one of that search's REQUIRED items the role uses (one is enough to list it), spelled as the search lists them. A technology named only as a plus, in a client list or for another team is not used. [] only when none is.
- stack_role: "core" — the role's main language or framework is in stack_used (in the title, or most of the work); "secondary" — a required item is used, but the role's main stack is something else; "none" — stack_used is [].
- role_types: that search's acceptable role types the job is, spelled as the search lists them — judge by that list, never by the search's name (a backend role is backend in a search called "Full-Stack"); [] when it is none of them.
- role_type: "match" — role_types is not [], or the search accepts any role type; "adjacent" — another engineering category (frontend for a search that lists full-stack and backend); "other" — a different discipline (QA, data, design, management, sales).
- nice_used: that search's nice-to-have items the role uses, spelled as the search lists them.
- excluded: that search's auto-reject signals that describe THIS role — a word in a sentence about someone else does not count ("you will mentor juniors" is not a junior role).
- off_stack: how much of the technology the role requires is in neither of that search's lists — "none", "some" (one or two notable extras), "most" (the role is mainly built on other tech).

location_match = true ONLY when the role is open to that search's candidate per its location preferences above. Default to false when unclear.

red_flags: short kebab-case tags such as "wordpress-only", "onsite-required-wrong-city", "junior-level", "country-locked", "eu-only", "residency-required", "work-permit-required", "no-visa-sponsorship", "contract-only", "low-pay", "no-salary-listed", "stack-mismatch", "${INJECTION_FLAG}". Empty array if none.

summary: ONE sentence (max ~25 words) explaining why the posting fits that search or does not.`;
}

/**
 * Where the candidate lives and whether they would move (ADR 0033) — said
 * only when one of them is set, so a search that does not care costs the
 * prompt nothing. Codes, like the location line.
 */
function describeEligibility(profile: Profile): string {
  const relocation = isRelocation(profile.relocation) ? profile.relocation : 'no';
  if (!profile.residence && relocation === 'no') return '';
  const lives = profile.residence ? `lives in: ${profile.residence}` : 'residence not stated';
  return `\n- Candidate ${lives}; ${RELOCATION_PROMPT[relocation]}`;
}

/**
 * The groups that hold a search's countries, said outright (#530): with the
 * rule alone, the model wrote "remote EUROPE excludes PL/DE" and dismissed
 * the posting. Groups the search lists itself, and WORLDWIDE, go unsaid.
 */
function describeGroups(profile: Profile): string {
  const groups = REGIONS.filter(
    (r) => !profile.regions.includes(r.code) && r.countries.some((c) => profile.countries.includes(c)),
  ).map((r) => r.code);
  if (groups.length === 0) return '';
  return `\n- Its countries lie inside: ${groups.join(', ')}`;
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
