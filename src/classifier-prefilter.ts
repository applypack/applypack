import { z } from 'zod';
import type { Profile } from '@prisma/client';
import { logger } from './logger';
import { extractJson } from './text-utils';
import type { ScoringCall } from './classifier';
import { titleHasKeyword } from './filter';
import type { ClassifyInput } from './types';
import { UNTRUSTED_DIRECTIVE_SHORT, fence } from './prompt-fence';

// Stage 1 uses the same model as stage 2; the saving comes from the much
// shorter prompt + tiny max_tokens, so when most fetched jobs are off-target
// total spend stays ~30-40% lower than running the full classifier on all.
const MAX_TOKENS = 100;
const MAX_DESC_CHARS = 800;

const PrefilterSchema = z.object({
  relevant: z.boolean(),
  reason: z.string(),
});

export type PrefilterResult = z.infer<typeof PrefilterSchema>;

export async function preClassify(
  input: ClassifyInput,
  profiles: Profile[],
  call: ScoringCall,
): Promise<PrefilterResult | null> {
  const { system: systemPrompt, user: userText } = buildPrefilterPrompt(input, profiles);

  const out = await call.ai.complete({
    json: true,
    system: systemPrompt,
    user: userText,
    maxTokens: MAX_TOKENS,
    label: 'prefilter',
    role: 'classifier',
    subject: call.subject,
  });
  if (out === null) return null;
  call.ledgerIds.push(...out.ledgerIds);

  const parsed = parsePrefilterResponse(out.text);
  if (parsed) return parsed;
  await call.ai.unparsed(out);
  logger.warn({ raw: out.text.slice(0, 300), title: input.title }, 'prefilter: response did not match schema');
  return null;
}

/**
 * Whether the gate is asked at all (#441). It reads the first MAX_DESC_CHARS
 * characters, and asked three times about each of 13 postings single-stage
 * scoring kept, it turned away 6 — every time over the stack, which sat
 * further down, or read React as no match for a JavaScript search. A posting
 * whose title or text names a search's required stack goes to the classifier;
 * the gate judges only those that name none of it.
 */
export function prefilterMayJudge(input: Pick<ClassifyInput, 'title' | 'description'>, profiles: Profile[]): boolean {
  const text = `${input.title}\n${input.description}`.toLowerCase();
  return !profiles.some((p) => p.stackRequired.some((k) => titleHasKeyword(text, k)));
}

/**
 * Pure JSON-extraction + schema-validation. Exported separately so we can
 * unit-test the parser without hitting the Anthropic API.
 */
export function parsePrefilterResponse(text: string): PrefilterResult | null {
  const json = extractJson(text);
  if (json === null) return null;
  const parsed = PrefilterSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * System + user for the stage-1 gate. Pure.
 *
 * The gate is a union (ADR 0028): one search wanting the role is enough. Two
 * sentences here were measured, not styled. The shipped wording admitted 2 of
 * 24 postings and only 1 of the 8 the full classifier scored 75-90, because
 * the model reads "the stack is not mentioned" as "the stack mismatches" —
 * and it only ever sees the first 800 characters, where most postings are
 * still company boilerplate. Saying so explicitly, plus "unambiguous mismatch
 * for EVERY search", took the same single search to 17 of 24 and 5 of 8.
 */
export function buildPrefilterPrompt(
  input: ClassifyInput,
  profiles: Profile[],
): { system: string; user: string } {
  const searches = profiles
    .map(
      (p) =>
        `SEARCH ${p.id}: required stack — ${
          p.stackRequired.length > 0 ? p.stackRequired.join(', ') : '(any stack)'
        }; auto-reject — ${
          p.stackExclude.length > 0 ? p.stackExclude.join(', ') : '(none)'
        }; seniority — ${p.seniority.length > 0 ? p.seniority.join('/') : 'any'}`,
    )
    .join('\n');
  const every = profiles.length > 1 ? 'EVERY search listed' : 'the search listed';

  const system = `You are a fast yes/no relevance gate. Decide whether a job posting could plausibly fit ${
    profiles.length > 1 ? 'AT LEAST ONE of these searches' : 'this search'
  } before a more expensive classifier looks at it.

${UNTRUSTED_DIRECTIVE_SHORT}

${searches}

Output STRICT JSON ONLY (no prose):

{"relevant": true|false, "reason": "one short phrase"}

Be GENEROUS. You see only the first ${MAX_DESC_CHARS} characters of the posting, so a stack named further down is INVISIBLE to you: absence of evidence is NOT a mismatch. Say true whenever ${
    profiles.length > 1 ? 'any one search' : 'the search'
  } could plausibly fit, and answer false ONLY when the posting is an unambiguous mismatch for ${every} — wrong seniority, an auto-reject signal, or a clearly different discipline.`;

  const user = [
    fence(
      'JOB POSTING',
      [
        `Title: ${input.title}`,
        `Location: ${input.location || '(not specified)'}`,
        '',
        `Description (first ${MAX_DESC_CHARS} chars):`,
        input.description.slice(0, MAX_DESC_CHARS),
      ].join('\n'),
    ),
    '',
    'Return raw JSON only.',
  ].join('\n');

  return { system, user };
}
