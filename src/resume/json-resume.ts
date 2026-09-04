import { z } from 'zod';

/*
 * The structured shape of a resume, as the subset of JSON Resume ApplyPack
 * renders (ADR 0039). Pure: a schema, a type and the reader for the stored
 * column — no I/O, no AI.
 *
 * Why a standard and not our own shape: the fields below are the ones every
 * resume has, named the way an ecosystem of parsers and themes already names
 * them, so a structure exported from here is worth something outside this
 * product. What is NOT here is the rest of the standard (awards, volunteer,
 * publications, interests, references, meta): a renderer that cannot draw a
 * section has no business asking a model to fill it.
 *
 * Every string in here is copied from the resume, never written by the model
 * — structure-anchor.ts enforces that at persist time.
 */

/** Longest name / summary / bullet we keep; past this the model is writing, not copying. */
const MAX_LINE_CHARS = 1_500;
/** Entries per section (roles, groups, degrees). */
const MAX_ITEMS = 40;
/** Terms in one skills group — the corpus has a line of 60, so this is not 40. */
const MAX_TERMS = 120;

/*
 * Caps SLICE, they do not reject. Both producers hit them for honest reasons —
 * a model that lists every term of a skills line, a fallback parser splitting
 * the same line on commas — and a structure is display data, not a boundary:
 * dropping the whole reply because entry 41 exists would leave the page with
 * nothing where it could have had forty.
 */
const capped = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .default([])
    .transform((arr) => arr.slice(0, max));

const line = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

const required = z.string().trim().min(1);
/** A list of strings: over-long entries become empty and drop out rather than failing the parse. */
const textList = capped(z.string().trim().max(MAX_LINE_CHARS).catch(''), MAX_TERMS).transform((arr) =>
  arr.filter((s) => s.length > 0),
);
const entries = <T extends z.ZodTypeAny>(item: T) => capped(item, MAX_ITEMS);

export const JsonResumeSchema = z.object({
  basics: z
    .object({
      name: line,
      label: line,
      email: line,
      phone: line,
      url: line,
      location: line,
      summary: line,
      profiles: textList,
    })
    .default({ profiles: [] }),
  work: entries(
      z.object({
        name: line,
        position: line,
        location: line,
        startDate: line,
        endDate: line,
        summary: line,
        highlights: textList,
      }),
  ),
  education: entries(
      z.object({
        institution: line,
        area: line,
        studyType: line,
        startDate: line,
        endDate: line,
        score: line,
      }),
  ),
  skills: entries(z.object({ name: line, keywords: textList })),
  languages: entries(z.object({ language: line, fluency: line })),
  certificates: entries(z.object({ name: line, issuer: line, date: line })),
  projects: entries(z.object({ name: line, description: line, url: line, highlights: textList })),
  /** Sections the reader found but the schema has no home for, kept as headed prose. */
  extras: entries(z.object({ heading: required, lines: textList })),
});

export type JsonResume = z.infer<typeof JsonResumeSchema>;
export type WorkEntry = JsonResume['work'][number];
export type SkillGroup = JsonResume['skills'][number];

/** The empty structure, so a renderer never branches on null. */
export function emptyResume(): JsonResume {
  return JsonResumeSchema.parse({});
}

/**
 * Reads the `Resume.structure` column. Unparseable JSON, an older shape or
 * NULL all mean the same thing to a caller — there is no structure here, use
 * the text fallback — so this returns null rather than throwing.
 */
export function readStructure(value: unknown): JsonResume | null {
  if (value === null || value === undefined) return null;
  const parsed = JsonResumeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Every string the structure carries, in reading order. What the anchor guard checks. */
export function structureStrings(resume: JsonResume): string[] {
  const out: string[] = [];
  const push = (...vs: Array<string | null>) => out.push(...vs.filter((v): v is string => v !== null));
  const b = resume.basics;
  push(b.name, b.label, b.email, b.phone, b.url, b.location, b.summary, ...b.profiles);
  for (const w of resume.work) push(w.name, w.position, w.location, w.startDate, w.endDate, w.summary, ...w.highlights);
  for (const e of resume.education) push(e.institution, e.area, e.studyType, e.startDate, e.endDate, e.score);
  for (const s of resume.skills) push(s.name, ...s.keywords);
  for (const l of resume.languages) push(l.language, l.fluency);
  for (const c of resume.certificates) push(c.name, c.issuer, c.date);
  for (const p of resume.projects) push(p.name, p.description, p.url, ...p.highlights);
  for (const x of resume.extras) push(x.heading, ...x.lines);
  return out;
}

/** How much of a resume the structure accounts for — the number the render page shows. */
export function structureCoverage(resume: JsonResume): { sections: number; roles: number; bullets: number } {
  const sections =
    (resume.basics.summary ? 1 : 0) +
    (resume.skills.length > 0 ? 1 : 0) +
    (resume.work.length > 0 ? 1 : 0) +
    (resume.education.length > 0 ? 1 : 0) +
    (resume.languages.length > 0 ? 1 : 0) +
    (resume.certificates.length > 0 ? 1 : 0) +
    (resume.projects.length > 0 ? 1 : 0) +
    resume.extras.length;
  return {
    sections,
    roles: resume.work.length,
    bullets: resume.work.reduce((n, w) => n + w.highlights.length, 0),
  };
}
