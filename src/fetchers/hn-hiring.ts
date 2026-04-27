import { z } from 'zod';
import { fetchWithRetry, stripHtml } from '../http';
import { logger } from '../logger';
import { parseHnComment } from './hn-parser';
import type { NormalizedJob } from '../types';

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';
const THREAD_TIMEOUT_MS = 30_000;
const MAX_THREAD_AGE_DAYS = 60;
const HIRING_TITLE_RE = /^Ask HN: Who is hiring\??\s*\(/i;

const SearchHitSchema = z
  .object({
    objectID: z.string(),
    title: z.string().optional().nullable(),
    created_at: z.string().optional(),
    created_at_i: z.number().optional(),
  })
  .passthrough();

const SearchResultSchema = z
  .object({ hits: z.array(SearchHitSchema) })
  .passthrough();

const ItemChildSchema: z.ZodType<{
  id: number;
  text: string | null;
  created_at_i?: number;
}> = z
  .object({
    id: z.number(),
    text: z.string().nullable(),
    created_at_i: z.number().optional(),
  })
  .passthrough();

const ThreadSchema = z
  .object({
    id: z.number(),
    title: z.string().optional(),
    children: z.array(ItemChildSchema).optional().default([]),
  })
  .passthrough();

interface HiringThread {
  objectID: string;
  createdAtI: number;
  title: string;
}

/**
 * Locates the most recently posted "Ask HN: Who is hiring? (Month YYYY)"
 * thread within the last 60 days. Returns null when no thread matches.
 */
export async function findLatestHiringThread(
  now: Date = new Date(),
): Promise<HiringThread | null> {
  const url = `${ALGOLIA_BASE}/search_by_date?query=Ask+HN+Who+is+hiring&tags=story&hitsPerPage=10`;
  const resp = await fetchWithRetry(url);
  const raw: unknown = await resp.json();
  const parsed = SearchResultSchema.safeParse(raw);
  if (!parsed.success) return null;

  const cutoffEpoch = Math.floor(now.getTime() / 1000) - MAX_THREAD_AGE_DAYS * 86_400;
  let best: HiringThread | null = null;
  for (const h of parsed.data.hits) {
    const t = (h.title ?? '').trim();
    if (!HIRING_TITLE_RE.test(t)) continue;
    const createdAtI = h.created_at_i ?? 0;
    if (createdAtI < cutoffEpoch) continue;
    if (!best || createdAtI > best.createdAtI) {
      best = { objectID: h.objectID, createdAtI, title: t };
    }
  }
  return best;
}

/**
 * Pull the latest Who-is-hiring thread, parse top-level comments, and emit
 * NormalizedJobs for those that have recognisable structure.
 */
export async function fetchHnHiring(companyId: number): Promise<NormalizedJob[]> {
  const thread = await findLatestHiringThread();
  if (!thread) {
    logger.warn('hn-hiring: no recent Who-is-hiring thread found');
    return [];
  }
  logger.info(
    { thread: thread.objectID, title: thread.title },
    'hn-hiring: thread located',
  );

  const itemUrl = `${ALGOLIA_BASE}/items/${thread.objectID}`;
  const resp = await fetchWithRetry(itemUrl, { timeoutMs: THREAD_TIMEOUT_MS });
  const raw: unknown = await resp.json();
  const parsed = ThreadSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      { errors: parsed.error.flatten().fieldErrors },
      'hn-hiring: thread schema invalid',
    );
    return [];
  }

  const out: NormalizedJob[] = [];
  let total = 0;
  let parsedOk = 0;
  for (const child of parsed.data.children) {
    total++;
    if (!child.text) continue;
    const cleanedText = stripHtml(child.text);
    const parsedComment = parseHnComment(cleanedText);
    if (!parsedComment) continue;
    parsedOk++;
    out.push({
      companyId,
      externalId: String(child.id),
      title: parsedComment.title,
      url: parsedComment.url ?? `https://news.ycombinator.com/item?id=${child.id}`,
      location: parsedComment.location ?? '',
      description: buildDescription(parsedComment),
      postedAt: child.created_at_i
        ? new Date(child.created_at_i * 1000)
        : new Date(),
    });
  }

  if (total > 0 && parsedOk / total < 0.3) {
    logger.warn(
      { total, parsedOk },
      'hn-hiring: low-yield month — most comments did not parse',
    );
  }
  logger.info({ total, parsedOk, jobs: out.length }, 'hn-hiring: parse complete');
  return out;
}

function buildDescription(parsed: ReturnType<typeof parseHnComment>): string {
  if (!parsed) return '';
  const head = [
    parsed.companyName ? `Company: ${parsed.companyName}` : null,
    parsed.location ? `Location: ${parsed.location}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return head ? `${head}\n\n${parsed.rawText}` : parsed.rawText;
}
