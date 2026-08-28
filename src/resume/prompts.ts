import { z } from 'zod';
import { extractJson } from '../text-utils';

/*
 * Prompt builders + zod parsers for the two resume calls. Pure: no I/O.
 * The rules in MATCH_SYSTEM are the ATS/tailoring rulebook from the
 * job-apply skill, boiled down to what a single JSON reply can act on.
 */

export const SCAN_MAX_TOKENS = 3_000;
export const MATCH_MAX_TOKENS = 8_000;
const MAX_RESUME_CHARS = 30_000;
const MAX_JOB_CHARS = 15_000;

export interface Prompt {
  system: string;
  user: string;
}

const nullableText = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

const tagList = z
  .array(z.string())
  .default([])
  .transform((arr) => [...new Set(arr.map((s) => s.trim().toLowerCase()).filter(Boolean))]);

export const ScanSchema = z.object({
  title: nullableText,
  seniority: nullableText,
  years_experience: z.number().int().min(0).max(60).nullish().transform((v) => v ?? null),
  skills: tagList,
  role_types: tagList,
  summary: z.string(),
  issues: z
    .array(z.object({ section: z.string(), issue: z.string(), fix: z.string() }))
    .max(40)
    .default([]),
});
export type ResumeScan = z.infer<typeof ScanSchema>;
export type ResumeIssue = ResumeScan['issues'][number];

export const KEYWORD_STATUSES = ['present', 'add', 'cannot_claim'] as const;
export const ACTION_SECTIONS = ['title', 'summary', 'skills', 'experience', 'education', 'format'] as const;
export const ACTION_PRIORITIES = ['high', 'medium', 'low'] as const;

export const MatchSchema = z.object({
  match_score: z.number().int().min(0).max(100),
  summary: z.string(),
  strengths: z.array(z.string()).max(20).default([]),
  red_flags: z.array(z.string()).max(20).default([]),
  keywords: z
    .array(
      z.object({
        term: z.string(),
        priority: z.number().int().min(1).max(4),
        status: z.enum(KEYWORD_STATUSES),
        where: nullableText,
        note: nullableText,
      }),
    )
    .max(80)
    .default([]),
  actions: z
    .array(
      z.object({
        section: z.enum(ACTION_SECTIONS),
        where: z.string(),
        what: z.string(),
        why: z.string(),
        priority: z.enum(ACTION_PRIORITIES),
      }),
    )
    .max(40)
    .default([]),
  removals: z
    .array(
      z.object({
        section: z.enum(ACTION_SECTIONS),
        where: z.string(),
        what: z.string(),
        why: z.string(),
      }),
    )
    .max(30)
    .default([]),
});
export type ResumeMatchResult = z.infer<typeof MatchSchema>;
export type MatchKeyword = ResumeMatchResult['keywords'][number];
export type MatchAction = ResumeMatchResult['actions'][number];
export type MatchRemoval = ResumeMatchResult['removals'][number];

const SCAN_SYSTEM = `You read a software engineer's resume and return a structured profile as JSON. No prose, no code fences.

Fields:
- "title": the headline / target title the resume presents (string or null)
- "seniority": one of junior | mid | senior | staff | lead | principal (best guess, or null)
- "years_experience": integer, total years of professional experience estimated from the dates (or null)
- "skills": lowercase canonical tags for technologies the resume actually names — languages, frameworks, databases, cloud, infra, tools, methodologies. Use the common short form ("php", "laravel", "postgresql", "aws", "ci/cd", "docker"). No duplicates, no soft skills.
- "role_types": job categories the resume supports, e.g. "backend", "full-stack", "platform", "ai-engineer"
- "summary": two plain sentences describing the candidate the way a recruiter would after a 10-second scan
- "issues": job-agnostic problems an ATS parser or recruiter would flag, each {"section", "issue", "fix"}. Check: non-standard section headings or order (expected Summary → Skills → Experience → Education); mixed date formats; bullets with no measurable outcome; more than 4 bullets in one role; skills listed but never evidenced in experience; buzzwords and filler; missing contact line; photo / age / marital status (US market); likely length over 2 pages; tables, columns or text boxes that break parsers. Include what can simply be REMOVED to make the resume cleaner (unevidenced skills, empty sections, decorative lines, roles too old to matter). Concrete and short. Empty array if clean.

Output exactly:
{"title": string|null, "seniority": string|null, "years_experience": integer|null, "skills": string[], "role_types": string[], "summary": string, "issues": [{"section": string, "issue": string, "fix": string}]}`;

const MATCH_SYSTEM = `You compare ONE resume against ONE job posting and tell the candidate exactly what to change before applying. Optimise for the ATS parser first and for the recruiter's 6-10 second scan second. Return JSON only — no prose, no code fences.

METHOD
1. Extract the posting's keywords in priority order: 1 = required technical skills (requirements / qualifications), 2 = the exact job title as posted, 3 = methodology and process terms (CI/CD, code review, agile, on-call, testing), 4 = domain terms (fintech, marketplace, healthcare). Mirror the posting's exact wording — if it says "Golang", the keyword is "Golang".
2. For every keyword decide one status:
   - "present": it is already in the resume. Say where.
   - "add": it is missing but the resume's own facts genuinely support it (same technology under another name, an obvious part of work already described). Say exactly where to put it and suggest the wording.
   - "cannot_claim": the posting wants it and nothing in the resume supports it. Never invent experience — when unsure, choose cannot_claim.
3. Where recruiters look: in their 6-10 seconds they read the title line, the summary and the MOST RECENT role (roughly the last two years) — almost nothing else. So the title and the top required skills must be visible in the top third of page one (title line, summary, skills section), and the current/most recent role must carry the strongest, most relevant accomplishment as its first bullet. Bullets of the two most recent roles may be reworded or reordered; older roles get trims only. Max 4 bullets per role. Every bullet should carry a number (%, $, users, uptime, time saved).
4. "actions" is the to-do list of ADDITIONS and CHANGES: concrete edits, each pointing at one place ("where") with the exact change ("what") and the posting requirement it serves ("why"). Concentrate them on the title, summary, skills and the most recent role. Priority "high" = a priority-1 keyword, the title, or the first bullet of the current role; "medium" = priority 2-3 or another recent-role bullet; "low" = polish. Suggested wording must read like a human wrote it — plain, specific, no filler. Never use: results-driven, passionate, synergy, dynamic, go-getter, team player, detail-oriented, proven track record, responsible for, seasoned, leverage, utilize.
5. "removals" is the list of what to DELETE or SHORTEN so the resume reads cleaner for this posting: skills listed but never evidenced in a role; bullets with no number or no relevance to this posting (especially in roles older than two years); roles older than ~10 years condensed to one line; duplicated tech lists; filler sentences; anything a US recruiter does not want (photo, age, marital status, full street address); sections that add nothing (objective, references available on request). Each item: section, where, what to remove, why.
6. "red_flags": hard mismatches the candidate should know before applying — seniority, location or work authorization, on-site requirement, a core stack the resume does not have.
7. "match_score" 0-100 with the SAME rubric every time, so re-uploads of an edited resume are comparable: 60 points for priority-1 keyword coverage (present counts fully, addable counts half), 20 for title + summary alignment with the posting, 20 for how well the most recent role speaks to this posting; then subtract 10 per hard red flag. Round to an integer.

OUTPUT (exactly this shape):
{
  "match_score": integer,
  "summary": "one-sentence verdict",
  "strengths": ["what already sells this candidate for this role"],
  "red_flags": ["hard mismatch"],
  "keywords": [{"term": string, "priority": 1|2|3|4, "status": "present"|"add"|"cannot_claim", "where": string|null, "note": string|null}],
  "actions": [{"section": "title"|"summary"|"skills"|"experience"|"education"|"format", "where": string, "what": string, "why": string, "priority": "high"|"medium"|"low"}],
  "removals": [{"section": "title"|"summary"|"skills"|"experience"|"education"|"format", "where": string, "what": string, "why": string}]
}`;

export function buildScanPrompt(resumeText: string): Prompt {
  return {
    system: SCAN_SYSTEM,
    user: `RESUME:\n${clip(resumeText, MAX_RESUME_CHARS)}\n\nReturn raw JSON only.`,
  };
}

export interface MatchJobInput {
  title: string;
  companyName: string;
  location: string;
  description: string;
}

export function buildMatchPrompt(resumeText: string, job: MatchJobInput): Prompt {
  return {
    system: MATCH_SYSTEM,
    user: [
      'RESUME:',
      clip(resumeText, MAX_RESUME_CHARS),
      '',
      'JOB POSTING:',
      `Title: ${job.title}`,
      `Company: ${job.companyName}`,
      `Location: ${job.location || '(not specified)'}`,
      '',
      clip(job.description, MAX_JOB_CHARS) || '(no description)',
      '',
      'Return raw JSON only.',
    ].join('\n'),
  };
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseScanResponse(text: string): ParseResult<ResumeScan> {
  return parseWith(ScanSchema, text);
}

export function parseMatchResponse(text: string): ParseResult<ResumeMatchResult> {
  return parseWith(MatchSchema, text);
}

function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, text: string): ParseResult<T> {
  const json = extractJson(text);
  if (json === null) return { ok: false, error: 'no JSON object in reply' };
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: JSON.stringify(parsed.error.flatten().fieldErrors) };
  }
  return { ok: true, data: parsed.data };
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n[... truncated]` : s;
}

/* Readers for the Json columns — a stored row always came through the schemas above, so a mismatch means an older shape; fall back to empty. */

export function readIssues(v: unknown): ResumeIssue[] {
  const r = ScanSchema.shape.issues.safeParse(v);
  return r.success ? r.data : [];
}

export function readKeywords(v: unknown): MatchKeyword[] {
  const r = MatchSchema.shape.keywords.safeParse(v);
  return r.success ? r.data : [];
}

export function readActions(v: unknown): MatchAction[] {
  const r = MatchSchema.shape.actions.safeParse(v);
  return r.success ? r.data : [];
}

export function readRemovals(v: unknown): MatchRemoval[] {
  const r = MatchSchema.shape.removals.safeParse(v);
  return r.success ? r.data : [];
}
