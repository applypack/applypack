import { z } from 'zod';
import { getAiProvider } from '../ai-provider';
import { extractJson } from '../text-utils';
import { logger } from '../logger';
import { MAX_FIELD_CHARS } from './manual-job';

/*
 * Quick company/title/location extraction for pasted postings (/target).
 * One cheap classifier-model call over the posting head; never invents —
 * a fact the text does not state comes back null. The prompt builder and
 * parser are pure (tested); only extractPostingFacts talks to the provider.
 */

/** Postings put their identity at the top; the head keeps the call fast and cheap. */
const HEAD_CHARS = 3500;
const MAX_TOKENS = 200;

export interface PostingFacts {
  company: string | null;
  title: string | null;
  location: string | null;
}

const EXTRACT_SYSTEM = `You read one pasted job posting and extract three facts.
Reply with ONLY JSON: {"company": string|null, "title": string|null, "location": string|null}.
Rules:
- company: the hiring company's name — not a recruiting agency or a client mentioned in passing. null when never named.
- title: the advertised role title, verbatim from the posting (drop marketing suffixes like "- Join us!"). null when absent.
- location: the work location exactly as stated ("Remote (US)", "Berlin, hybrid"). null when not stated.
- Never invent or guess a fact the text does not contain.`;

export function buildExtractPrompt(description: string): { system: string; user: string } {
  return { system: EXTRACT_SYSTEM, user: description.slice(0, HEAD_CHARS) };
}

const FieldSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const s = (v ?? '').trim().slice(0, MAX_FIELD_CHARS);
    return s.length > 0 ? s : null;
  });

const ReplySchema = z.object({
  company: FieldSchema,
  title: FieldSchema,
  location: FieldSchema,
});

/** Tolerant parse of the model reply; null when nothing usable came back. */
export function parseExtractReply(raw: string): PostingFacts | null {
  const json = extractJson(raw);
  if (json === null) return null;
  const parsed = ReplySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export async function extractPostingFacts(description: string): Promise<PostingFacts | null> {
  const { system, user } = buildExtractPrompt(description);
  const text = await getAiProvider().complete({
    system,
    user,
    maxTokens: MAX_TOKENS,
    label: 'posting-extract',
  });
  if (!text) return null;
  const facts = parseExtractReply(text);
  if (!facts) logger.warn({ head: text.slice(0, 120) }, 'posting-extract: unparseable reply');
  return facts;
}
