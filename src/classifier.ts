import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Profile } from '@prisma/client';
import { config } from './config';
import { logger } from './logger';
import { sleep } from './http';
import { extractJson } from './text-utils';
import type { ClassifyInput, ClaudeClassification } from './types';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 600;
const MAX_DESC_CHARS = 4000;
const RATE_LIMIT_RETRY_DELAY_MS = 2_000;

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const ClassificationSchema = z.object({
  fit_score: z.number().int().min(0).max(100),
  location_match: z.boolean(),
  salary_min_usd: z.number().int().nullable(),
  salary_max_usd: z.number().int().nullable(),
  tech_match: z.array(z.string()),
  red_flags: z.array(z.string()),
  summary: z.string(),
});

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

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await client.messages.create({
        model: MODEL,
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

      const json = extractJson(text);
      if (json !== null) {
        const parsed = ClassificationSchema.safeParse(json);
        if (parsed.success) {
          return parsed.data;
        }
        logger.warn(
          {
            raw: text.slice(0, 500),
            errors: parsed.error.flatten().fieldErrors,
            title: input.title,
          },
          'classifier: response did not match schema',
        );
      } else {
        logger.warn(
          { raw: text.slice(0, 500), title: input.title },
          'classifier: no JSON found in response',
        );
      }

      if (attempt === 0) {
        continue;
      }
      return null;
    } catch (err) {
      const status =
        err instanceof Anthropic.APIError ? err.status : undefined;
      if (status === 429 && attempt === 0) {
        logger.warn({ title: input.title }, 'classifier: rate-limited, retrying');
        await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        continue;
      }
      logger.error(
        { err, status, title: input.title },
        'classifier: request failed',
      );
      return null;
    }
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
- Required tech stack (must appear in title or be strongly hinted in the description; otherwise score low): ${required}
- Nice-to-have stack (boost fit_score when present): ${niceToHave}
- Auto-reject signals (drastically lower fit_score if these match the role): ${exclude}
- Location preferences: ${locationLine}
- ${salaryLine}${notesLine}

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

