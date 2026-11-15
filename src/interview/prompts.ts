import { z } from 'zod';
import { fence, untrustedDirective } from '../prompt-fence';
import { extractJson, firstOf, hashShortId, jsonFailure, type ParseResult } from '../text-utils';
import { unbackedFigures } from './figures';
import type { InterviewLanguage } from './languages';

/*
 * The interview preparation for one posting (ADR 0065): the prompt, the
 * reply's shape, and what code makes of the reply before it is stored. Pure —
 * prep.ts talks to the engine, store.ts to the database.
 */

export const INTERVIEW_PROMPT_VERSION = 1;
/** The ANSWER's size (gotcha 16): about fifteen questions with their points, in a script that may cost two tokens a word. */
export const INTERVIEW_MAX_TOKENS = 10_000;
export const INTERVIEW_TIMEOUT_MS = 4 * 60_000;

const MAX_JOB_CHARS = 15_000;
const MAX_RESUME_CHARS = 30_000;
/** One note, and all of them together: a long career fits, a pasted book does not. */
export const MAX_NOTE_CHARS = 40_000;
const MAX_NOTES_CHARS = 120_000;
const MAX_QUESTIONS = 20;
const MAX_POINTS = 6;

const QUESTION_KINDS = ['about_you', 'technical', 'behavioral', 'company'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** What `based_on` says when an answer rests on the resume rather than a note. */
export const FROM_RESUME = 'resume';

const text = z.string().trim().min(1);
const QuestionSchema = z.object({
  // An unknown kind is a question all the same.
  kind: z.enum(QUESTION_KINDS).catch('about_you'),
  question: text,
  why: z.string().trim().catch(''),
  answer: z.array(text).catch([]).transform(firstOf(MAX_POINTS)),
  based_on: z.array(z.string().trim()).catch([]),
  missing: z
    .string()
    .nullish()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
});
const ReplySchema = z.object({ questions: z.array(QuestionSchema).min(1).transform(firstOf(MAX_QUESTIONS)) });

type ReplyQuestion = z.infer<typeof QuestionSchema>;

/** A question as the page reads it: the reply's, plus the figures no source of the person's states. */
export interface PrepQuestion extends ReplyQuestion {
  unbacked: string[];
}

const StoredSchema = z.array(QuestionSchema.extend({ unbacked: z.array(z.string()).catch([]) }));

export function parseInterviewResponse(reply: string): ParseResult<ReplyQuestion[]> {
  const json = extractJson(reply);
  if (json === null) return jsonFailure(reply);
  const parsed = ReplySchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: JSON.stringify(parsed.error.flatten().fieldErrors) };
  return { ok: true, data: parsed.data.questions };
}

/** The stored column; a shape from another version reads as nothing prepared. */
export function readQuestions(stored: unknown): PrepQuestion[] {
  const parsed = StoredSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

export interface InterviewNote {
  title: string;
  text: string;
}

export interface InterviewInput {
  job: { title: string; companyName: string; location: string; description: string };
  language: InterviewLanguage;
  /** Null when the person prepares from their notes alone. */
  resumeText: string | null;
  notes: readonly InterviewNote[];
  /** Skills the person confirmed on a comparison (CandidateFact). */
  confirmedFacts: readonly { term: string; note: string | null }[];
  /** The verification's reading of the company; context for the questions, never a fact about the person (ADR 0042). */
  companySnapshot: string | null;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n[... truncated]` : s;
}

/** The notes one prompt holds, in the order given — the store hands them newest first. */
export function notesThatFit<N extends InterviewNote>(notes: readonly N[]): N[] {
  const out: N[] = [];
  let used = 0;
  for (const note of notes) {
    used += Math.min(note.text.trim().length, MAX_NOTE_CHARS);
    if (used > MAX_NOTES_CHARS) break;
    out.push(note);
  }
  return out;
}

function notesBlock(notes: readonly InterviewNote[]): string {
  return notesThatFit(notes)
    .map((note) => `## ${note.title.trim()}\n${clip(note.text.trim(), MAX_NOTE_CHARS)}`)
    .join('\n\n');
}

function systemPrompt(language: InterviewLanguage): string {
  return `You prepare ONE candidate for ONE job interview. The user prompt carries the job posting, sometimes a few sentences about the company, and the candidate's own material: their resume, their notes about past work, and skills they confirmed.

${untrustedDirective()}

TASK. List the questions this employer is most likely to ask in an interview for THIS posting, most likely first, and under each the points the candidate can make — built ONLY from the candidate's own material.

QUESTIONS — 12 to 16, each with a "kind":
- "about_you": background, motivation, why this role and this company, why they are moving.
- "technical": the posting's core stack and duties. Where the posting stresses something the candidate's material shows thinly or not at all, expect them to probe exactly there.
- "behavioral": a situation to tell — ownership, a conflict, a failure, a deadline, working without direction. Pick the ones this posting's wording points at.
- "company": what this employer would ask given what it builds, its domain and its stage.
At most three questions may be ones every interview asks; the rest must be traceable to this posting or this company. "why" is one full sentence naming what in the posting or the company makes the question likely.

ANSWERS — "answer" is 2 to 5 talking points, each one sentence the candidate could say, in the first person. Points, not a script.
- EVIDENCE. Every fact about the candidate — an employer, a project, a tool, a number, a duration, a result — must be stated in the resume, the notes or the confirmed skills. Never invent, never round up, never borrow from the posting or the company context: those describe the employer, not the candidate.
- When the material holds a project or a situation that fits, build the answer on it and name it in "based_on": the note's title exactly as its "## " line gives it, or "${FROM_RESUME}".
- When the material lacks what a good answer needs, write fewer points and say in "missing", in one sentence addressed to the candidate as "you", what to recall or write down. Never fill the gap with invention, and never put that advice inside "answer": a point is something to say to the interviewer. "missing" is null when nothing is.

LANGUAGE. The material may be written in any language, or several. Write "question", "why", "answer" and "missing" in ${language.english} — the language the interview will be held in. Keep the names of technologies, companies and products as they are written. Copy "based_on" verbatim.

Output exactly:
{"questions": [{"kind": "about_you"|"technical"|"behavioral"|"company", "question": string, "why": string, "answer": string[], "based_on": string[], "missing": string|null}]}`;
}

export function buildInterviewPrompt(input: InterviewInput): { system: string; user: string } {
  const { job } = input;
  const lines: string[] = [
    fence(
      'JOB POSTING',
      [
        `Title: ${job.title}`,
        `Company: ${job.companyName}`,
        `Location: ${job.location || '(not specified)'}`,
        '',
        clip(job.description, MAX_JOB_CHARS) || '(no description)',
      ].join('\n'),
    ),
    '',
  ];
  if (input.companySnapshot?.trim()) {
    lines.push('COMPANY CONTEXT (about the employer — for choosing questions, never a fact about the candidate):', fence('COMPANY CONTEXT', input.companySnapshot), '');
  }
  if (input.resumeText?.trim()) lines.push(fence('RESUME', clip(input.resumeText, MAX_RESUME_CHARS)), '');
  const notes = notesBlock(input.notes);
  if (notes) lines.push("THE CANDIDATE'S NOTES about their past work, each under its title:", fence('CAREER NOTES', notes), '');
  // The person's own answers, like the letter's: outside every fence.
  if (input.confirmedFacts.length > 0) {
    lines.push('CANDIDATE-CONFIRMED SKILLS (true even where the resume does not show them):', ...input.confirmedFacts.map((f) => `- ${f.term}${f.note ? `: ${f.note}` : ''}`), '');
  }
  lines.push('Return raw JSON only.');
  return { system: systemPrompt(input.language), user: lines.join('\n') };
}

/**
 * The reply as it is stored. Code, not the model, decides two things: a
 * source an answer names must be one the person has (a note's own title, or
 * the resume), and a figure in an answer must be one their material states —
 * the posting and the company context are no source for either.
 */
export function settleQuestions(questions: readonly ReplyQuestion[], input: InterviewInput): PrepQuestion[] {
  const titles = new Map(input.notes.map((n) => [n.title.trim().toLowerCase(), n.title.trim()]));
  const sources = [input.resumeText ?? '', ...input.notes.map((n) => `${n.title}\n${n.text}`), ...input.confirmedFacts.map((f) => `${f.term} ${f.note ?? ''}`)];
  return questions.map((q) => {
    const basedOn = new Set<string>();
    for (const name of q.based_on) {
      const key = name.toLowerCase();
      if (key === FROM_RESUME && input.resumeText?.trim()) basedOn.add(FROM_RESUME);
      const title = titles.get(key);
      if (title) basedOn.add(title);
    }
    return { ...q, based_on: [...basedOn], unbacked: unbackedFigures(q.answer.join('\n'), sources) };
  });
}

/** What a preparation was written from: a different key later means the history or the posting changed since. */
export function sourceKeyOf(description: string, notes: readonly InterviewNote[]): string {
  return hashShortId(JSON.stringify([description, notes.map((n) => [n.title, n.text])]));
}
