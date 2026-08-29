import { z } from 'zod';
import type { Profile } from '@prisma/client';
import { logger } from './logger';
import { extractJson } from './text-utils';
import { getAiRuntime } from './ai-runtime';
import type { ClassifyInput } from './types';

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
  profile: Profile,
): Promise<PrefilterResult | null> {
  const systemPrompt = buildPrefilterPrompt(profile);
  const userText = [
    `Title: ${input.title}`,
    `Location: ${input.location || '(not specified)'}`,
    '',
    `Description (first 800 chars):`,
    input.description.slice(0, MAX_DESC_CHARS),
    '',
    'Return raw JSON only.',
  ].join('\n');

  const ai = await getAiRuntime();
  const text = await ai.provider.complete({
    system: systemPrompt,
    user: userText,
    maxTokens: MAX_TOKENS,
    label: 'prefilter',
    model: ai.classifierModel,
  });
  if (text === null) return null;

  const parsed = parsePrefilterResponse(text);
  if (parsed) return parsed;
  logger.warn({ raw: text.slice(0, 300), title: input.title }, 'prefilter: response did not match schema');
  return null;
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

function buildPrefilterPrompt(profile: Profile): string {
  const required =
    profile.stackRequired.length > 0
      ? profile.stackRequired.join(', ')
      : '(any stack)';
  const exclude =
    profile.stackExclude.length > 0
      ? profile.stackExclude.join(', ')
      : '(none)';
  const seniority =
    profile.seniority.length > 0
      ? profile.seniority.join('/')
      : 'any';

  return `You are a fast yes/no relevance gate. Decide whether a job posting could plausibly fit this candidate before a more expensive classifier looks at it.

Required stack (must be plausibly present): ${required}
Auto-reject signals (presence => not relevant): ${exclude}
Seniority preference: ${seniority}

Output STRICT JSON ONLY (no prose):

{"relevant": true|false, "reason": "one short phrase"}

Be GENEROUS — say true unless the role is clearly off (wrong stack, junior when senior wanted, etc.). Borderline cases should be true; the next stage will decide finely. False only when the mismatch is unambiguous.`;
}
