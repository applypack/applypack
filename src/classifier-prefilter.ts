import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Profile } from '@prisma/client';
import { config } from './config';
import { logger } from './logger';
import { sleep } from './http';
import { extractJson } from './text-utils';
import type { ClassifyInput } from './types';

// As of 2026, only Haiku 4.5 is available in the Haiku family (3.5 was
// retired). Stage 1 still saves cost vs. single-stage by using a much
// shorter prompt + smaller max_tokens, so when most fetched jobs are
// off-target the prompt-cached system block + tiny user/output keeps the
// total spend ~30-40% lower than running the full classifier on everything.
const PREFILTER_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 100;
const MAX_DESC_CHARS = 800;
const RATE_LIMIT_RETRY_DELAY_MS = 2_000;

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

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

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await client.messages.create({
        model: PREFILTER_MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userText }],
      });
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const parsed = parsePrefilterResponse(text);
      if (parsed) return parsed;

      logger.warn(
        { raw: text.slice(0, 300), title: input.title },
        'prefilter: response did not match schema',
      );
      if (attempt === 0) continue;
      return null;
    } catch (err) {
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      if (status === 429 && attempt === 0) {
        logger.warn({ title: input.title }, 'prefilter: rate-limited, retrying');
        await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        continue;
      }
      logger.error(
        { err, status, title: input.title },
        'prefilter: request failed',
      );
      return null;
    }
  }
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
