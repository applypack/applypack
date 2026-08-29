import { z } from 'zod';
import { getAiProvider } from '../ai-provider';
import { extractJson } from '../text-utils';
import { logger } from '../logger';
import { MAX_FIELD_CHARS } from './manual-job';

/*
 * Quick fact extraction for pasted postings (/target). One cheap
 * classifier-model call over the posting head; never invents — a fact the
 * text does not state comes back null. The input is the CLEANED paste:
 * posting-clean.mjs keeps the job-header block (title, company, location,
 * salary) while dropping the nav chrome that would otherwise eat the
 * HEAD_CHARS window. The prompt builder and parser are pure (tested);
 * only extractPostingFacts talks to the provider.
 */

/** Postings put their identity at the top; the head keeps the call fast and cheap. */
const HEAD_CHARS = 3500;
const MAX_TOKENS = 250;
const MAX_SALARY = 5_000_000;

export interface PostingFacts {
  company: string | null;
  title: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  workplace: 'remote' | 'hybrid' | 'onsite' | null;
}

const EXTRACT_SYSTEM = `You read one pasted job posting (possibly with page chrome around it) and extract facts.
Reply with ONLY JSON: {"company": string|null, "title": string|null, "location": string|null, "salary_min": number|null, "salary_max": number|null, "workplace": "remote"|"hybrid"|"onsite"|null}.
Rules:
- company: the hiring company's name — not a recruiting agency, a job board, or a client mentioned in passing. null when never named.
- title: the advertised role title, verbatim from the posting (drop marketing suffixes like "- Join us!"). null when absent.
- location: the work location exactly as stated ("Remote (US)", "Berlin, hybrid"). null when not stated.
- salary_min / salary_max: yearly amounts in the posting's currency as plain integers ("$120K/yr - $160K/yr" → 120000 and 160000; a single figure fills both). Convert hourly to yearly only when the posting itself does; otherwise null.
- workplace: "remote", "hybrid" or "onsite" only when the posting states the arrangement; null otherwise.
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

const SalarySchema = z
  .union([z.number(), z.null(), z.undefined()])
  .transform((v) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_SALARY ? Math.round(v) : null,
  );

/* An off-list workplace value degrades to null instead of rejecting the reply. */
const WorkplaceSchema = z
  .enum(['remote', 'hybrid', 'onsite'])
  .nullish()
  .catch(null)
  .transform((v) => v ?? null);

const ReplySchema = z.object({
  company: FieldSchema,
  title: FieldSchema,
  location: FieldSchema,
  salary_min: SalarySchema.optional().default(null),
  salary_max: SalarySchema.optional().default(null),
  workplace: WorkplaceSchema.optional().default(null),
});

/** Tolerant parse of the model reply; null when nothing usable came back. */
export function parseExtractReply(raw: string): PostingFacts | null {
  const json = extractJson(raw);
  if (json === null) return null;
  const parsed = ReplySchema.safeParse(json);
  if (!parsed.success) return null;
  const r = parsed.data;
  // A reversed range is the model's slip, not the candidate's problem.
  const [salaryMin, salaryMax] =
    r.salary_min !== null && r.salary_max !== null && r.salary_min > r.salary_max
      ? [r.salary_max, r.salary_min]
      : [r.salary_min, r.salary_max];
  return {
    company: r.company,
    title: r.title,
    location: r.location,
    salaryMin,
    salaryMax,
    workplace: r.workplace,
  };
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
