import { z } from 'zod';
import { getAiRuntime, type AiRuntime } from '../ai-runtime';
import { extractJson } from '../text-utils';
import { logger } from '../logger';
import { fence, untrustedDirective } from '../prompt-fence';
import { MAX_FIELD_CHARS } from './manual-job';

/*
 * Quick fact extraction for pasted postings (/target) and saved ones (a
 * folder of postings, ADR 0062). One cheap classifier-model call over the
 * posting head; never invents — a fact the text does not state comes back
 * null. The input is the CLEANED paste: posting-clean.mjs keeps the
 * job-header block (title, company, location, salary) while dropping the nav
 * chrome that would otherwise eat the HEAD_CHARS window. A saved page also
 * brings its own <title>, which often names the company its text does not
 * (#451). The prompt builder and parser are pure (tested); only
 * extractPostingFacts talks to the provider.
 */

/** Postings put their identity at the top; the head keeps the call fast and cheap. */
const HEAD_CHARS = 6000;
const MAX_TOKENS = 250;
const MAX_SALARY = 5_000_000;

export interface PostingFacts {
  company: string | null;
  title: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  workplace: 'remote' | 'hybrid' | 'onsite' | null;
  /** False only when the model said the text is no job posting at all: a sign-in page, a list of results (#451). */
  isPosting: boolean;
}

const EXTRACT_SYSTEM = `You read one job posting (pasted, or a page someone saved, possibly with page chrome around it) and extract facts.

${untrustedDirective()}

Reply with ONLY JSON: {"company": string|null, "title": string|null, "location": string|null, "salary_min": number|null, "salary_max": number|null, "workplace": "remote"|"hybrid"|"onsite"|null, "is_job_posting": true|false}.
Rules:
- company: the hiring company's name — not a recruiting agency, a job board, or a client mentioned in passing. null when never named.
- title: the advertised role title, verbatim from the posting (drop marketing suffixes like "- Join us!"). null when absent.
- location: the work location exactly as stated ("Remote (US)", "Berlin, hybrid"). null when not stated.
- salary_min / salary_max: yearly amounts in the posting's currency as plain integers ("$120K/yr - $160K/yr" → 120000 and 160000; a single figure fills both). Convert hourly to yearly only when the posting itself does; otherwise null.
- workplace: "remote", "hybrid" or "onsite" only when the posting states the arrangement; null otherwise.
- PAGE TITLE, when given, is the saved page's own title as the browser showed it. It often names the role and the hiring company ("Senior Backend Engineer at Fennel Works | Careers"): read them from it when the posting does not say them. A job board's or a site's name in it ("… | Indeed", "… | LinkedIn") is not the hiring company.
- is_job_posting: false only when the text is plainly not one job advertisement — a sign-in or cookie page, an error page, a list of several jobs, a company's own page, an article or a newsletter. A short posting, a posting in an odd layout or with page chrome around it is a posting; when unsure, true.
- Never invent or guess a fact that neither the posting nor its page title contains.`;

/** `pageTitle`: a saved page's own <title> (datasets/saved-page.ts), fenced as the posting is. */
export function buildExtractPrompt(description: string, pageTitle: string | null = null): { system: string; user: string } {
  const posting = fence('JOB POSTING', description.slice(0, HEAD_CHARS));
  return { system: EXTRACT_SYSTEM, user: pageTitle ? `${fence('PAGE TITLE', pageTitle)}\n\n${posting}` : posting };
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

/* Only a stated false says "not a posting": a wrong "no" costs a posting someone saved by hand. */
const IsPostingSchema = z
  .boolean()
  .nullish()
  .catch(null)
  .transform((v) => v !== false);

const ReplySchema = z.object({
  company: FieldSchema,
  title: FieldSchema,
  location: FieldSchema,
  salary_min: SalarySchema.optional().default(null),
  salary_max: SalarySchema.optional().default(null),
  workplace: WorkplaceSchema.optional().default(null),
  is_job_posting: IsPostingSchema,
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
    isPosting: r.is_job_posting,
  };
}

/**
 * What a board or a careers page prints above a posting's text, and what a
 * posting opens with when it carries no title: "Full job description"
 * (Indeed), "About the job" (LinkedIn), "About Acme", "Who we are", "The
 * role". A heading is not the role. Measured on 1,710 stored descriptions:
 * one opens one in six of those whose first line is a title's length, and
 * none of the 148 it caught was a role.
 */
const SECTION_HEADING =
  /^(?:about\b.*|(?:full\s+)?job\s+(?:description|details|summary)|(?:role|position)\s+(?:description|summary|overview)|description|overview|summary|the\s+(?:role|job|position|opportunity)|who\s+we\s+are|what\s+you(?:['’]ll|\s+will)\s+do|responsibilities|requirements)\s*:?$/i;

/**
 * Deterministic last resort when neither the user nor the model named the
 * role: the paste's first line when it is a title's length — and not a
 * section heading, which says the text has no title line at all.
 */
export function fallbackTitle(description: string): string {
  const first =
    description
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  return first.length >= 4 && first.length <= 90 && !SECTION_HEADING.test(first) ? first : 'Untitled role';
}

interface ExtractOptions {
  /** A saved page's own <title> (datasets/saved-page.ts), fenced as the posting is. */
  pageTitle?: string | null;
  /** A posting the user saved into a folder, not one pasted: its own line on /ai (#543). */
  saved?: boolean;
  /** Takes the ledger rows of the call, which has no job yet: the caller names them on the job it stores (#543). */
  calls?: number[];
  ai?: Pick<AiRuntime, 'complete' | 'unparsed'>;
}

export async function extractPostingFacts(description: string, { pageTitle = null, saved = false, calls, ai }: ExtractOptions = {}): Promise<PostingFacts | null> {
  const { system, user } = buildExtractPrompt(description, pageTitle);
  const runtime = ai ?? (await getAiRuntime());
  const started = Date.now();
  const out = await runtime.complete({
    json: true,
    system,
    user,
    maxTokens: MAX_TOKENS,
    label: saved ? 'saved-posting-extract' : 'posting-extract',
    role: 'classifier',
  });
  if (!out) return null;
  calls?.push(...out.ledgerIds);
  const facts = parseExtractReply(out.text);
  if (!facts) {
    await runtime.unparsed(out);
    logger.warn({ head: out.text.slice(0, 120) }, 'posting-extract: unparseable reply');
  }
  logger.info({ ok: facts !== null, ms: Date.now() - started }, 'posting-extract: done');
  return facts;
}
