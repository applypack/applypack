import type { JobVerification, ResumeMatch } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { briefForPosting } from '../resume/brief';
import { generateCoverLetter } from '../resume/cover-letter';
import { documentFileName, draftDocx, draftPdf, type DraftInput } from '../resume/draft-document';
import { loadKeywordMatcher } from '../resume/keyword-matcher';
import { matchResumeToJob } from '../resume/match';
import { readMatchEvidence, readMatchMode } from '../resume/match-mode';
import { readPromptVersion } from '../resume/match-reuse';
import { PROMPT_VERSION, readActions, readHardRequirements, readKeywords, readRemovals, type CoverAngles } from '../resume/prompts';
import { knobsFrom } from '../resume/render/knobs';
import { readBreakdown } from '../resume/score';
import { getPostingRefreshedAt, getResumeOriginal, listMatchesForText } from '../resume/store';
import { LIVENESS_CODE_LABEL, runLivenessLadder } from '../verification/liveness';
import { verifyJob } from '../verification/verify';
import { resumeStyle } from '../web/resume-style';
import { compareStop, livenessStop, verifyStop, type PrepareStep, type Stop } from './gate';
import { planEdits, type EditPlan, type TailorPolicy } from './policy';
import { loadEditor, scoreOnText, tailor, tailorChecks, type EditOutcome } from './tailor';

/*
 * One application prepared with nobody watching (ADR 0063). The only file in
 * the module that spends AI: it calls what the dashboard's buttons call —
 * the liveness ladder, Compare, "Is it real?", the cover letter — in the
 * order that pays for the least, and applies the edits the policy allows.
 * It writes the rows those calls always write (a brief, a comparison, a
 * verification, a letter) and nothing else: the caller decides what becomes
 * of the result — the worker stores a pack, the dry run writes a report.
 */

export interface PackPosting {
  id: number;
  title: string;
  companyName: string;
  location: string;
  description: string;
  url: string;
  externalId: string;
  postedAt: Date;
  atsType: string;
  atsToken: string;
}

export interface PackResume {
  id: number;
  name: string;
  text: string;
  version: number;
  updatedAt: Date;
}

export interface PrepareOptions {
  /** The score editing must be able to reach (gate.ts). */
  minCeiling: number;
  policy: TailorPolicy;
  /** The company check with web search. */
  verify: boolean;
  /** Have the model judge the tailored text: the honest "after" score, and the comparison the Tailor page opens. */
  rejudge: boolean;
  /** Write a cover letter once the resume is ready; `angles` are the person's standing ones. */
  coverLetter: boolean;
  angles?: CoverAngles;
  onStep?: (step: PrepareStep) => void;
}

export interface PreparedResume {
  plan: EditPlan;
  outcome: EditOutcome;
  /** The text the pack keeps: the edited one, or the resume as it stood when a check failed. */
  text: string;
  /** The live score before and after — a floor, the alignment grades held still (tailor.ts). */
  score: { before: number; after: number };
  checks: string[];
  /** The comparison of the tailored text; null when it was not asked for, did not change or failed. */
  tailored: ResumeMatch | null;
  document: { kind: 'own' | 'clean'; basis: string; docx: Buffer; pdf: Buffer | null; fileName: string };
}

export interface Prepared {
  /** Where it stopped (gate.ts); null when it reached the end. */
  stop: Stop | null;
  /** A step that failed and left nothing to go on with; null otherwise. */
  error: string | null;
  match: ResumeMatch | null;
  /** A stored comparison of the same text answered, so none was paid for. */
  matchReused: boolean;
  verification: JobVerification | null;
  verificationReused: boolean;
  /** Why the company was not checked, when it was meant to be: the pack goes on without a verdict. */
  unchecked: string | null;
  resume: PreparedResume | null;
  letterId: number | null;
  /** Milliseconds per step, for the steps that did the work. */
  ms: Partial<Record<PrepareStep, number>>;
}

/** How many stored comparisons of one text are looked through for one to reuse. */
const STORED_CANDIDATES = 5;
/** A company check older than this is run again: a posting can go stale, a company rarely turns fake. */
const VERIFICATION_FRESH_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The last full comparison of this very text under today's prompt. Unlike the
 * dashboard's memo (match-reuse.ts) it does not ask which verification the
 * row read: here the company check comes after the comparison, and judging
 * the same text again because of it would only pay twice.
 */
async function storedComparison(jobId: number, resumeId: number, text: string): Promise<ResumeMatch | null> {
  const rows = await listMatchesForText(jobId, resumeId, text, STORED_CANDIDATES, await getPostingRefreshedAt(jobId));
  const usable = (r: ResumeMatch): boolean =>
    readMatchMode(r.breakdown) === 'full' && readPromptVersion(r.breakdown) === PROMPT_VERSION && readMatchEvidence(r.breakdown) === 'own';
  return rows.find(usable) ?? null;
}

export async function preparePosting(posting: PackPosting, resume: PackResume, opts: PrepareOptions): Promise<Prepared> {
  const out: Prepared = {
    stop: null,
    error: null,
    match: null,
    matchReused: false,
    verification: null,
    verificationReused: false,
    unchecked: null,
    resume: null,
    letterId: null,
    ms: {},
  };
  const timed = async <T>(step: PrepareStep, fn: () => Promise<T>): Promise<T> => {
    opts.onStep?.(step);
    const started = Date.now();
    try {
      return await fn();
    } finally {
      out.ms[step] = Date.now() - started;
    }
  };
  let reason = '';
  const onError = (r: string): void => {
    reason = r;
  };
  const because = (): string => reason || 'the engine gave no reason';

  const live = await timed('liveness', () =>
    runLivenessLadder({ url: posting.url, externalId: posting.externalId, atsType: posting.atsType, atsToken: posting.atsToken }),
  );
  out.stop = livenessStop({ liveness: live.liveness, label: LIVENESS_CODE_LABEL[live.code] });
  if (out.stop) return out;

  const me = { id: resume.id, name: resume.name, version: resume.version };
  out.match = await storedComparison(posting.id, resume.id, resume.text);
  out.matchReused = out.match !== null;
  if (!out.match) {
    const briefed = await timed('brief', () => briefForPosting(posting, { onError }));
    if (briefed?.reused) delete out.ms.brief;
    out.match = await timed('match', () => matchResumeToJob({ ...me, text: resume.text }, posting, { mode: 'full', brief: briefed, onError }));
  }
  const row = out.match;
  const breakdown = row ? readBreakdown(row.breakdown) : null;
  if (!row || !breakdown) {
    out.error = row ? 'The stored comparison carries no score breakdown.' : `The comparison failed: ${because()}`;
    return out;
  }
  out.stop = compareStop({ breakdown, hard: readHardRequirements(row.hardRequirements), minCeiling: opts.minCeiling });
  if (out.stop) return out;

  if (opts.verify) {
    out.verification = await prisma.jobVerification.findFirst({
      where: { jobId: posting.id, createdAt: { gte: new Date(Date.now() - VERIFICATION_FRESH_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    out.verificationReused = out.verification !== null;
    // A check that fails is not a verdict: the resume is still worth
    // preparing, and the pack says the company was not looked at.
    out.verification ??= await timed('verify', () => verifyJob(posting, onError)).catch((err: unknown) => {
      reason = err instanceof Error ? err.message : String(err);
      return null;
    });
    if (!out.verification) out.unchecked = because();
    else {
      out.stop = verifyStop(out.verification);
      if (out.stop) return out;
    }
  }

  const [editor, matcher] = await Promise.all([loadEditor(), loadKeywordMatcher()]);
  const keywords = readKeywords(row.keywords);
  const started = Date.now();
  opts.onStep?.('tailor');
  const plan = planEdits({ actions: readActions(row.actions), removals: readRemovals(row.removals), keywords, postingTitle: posting.title }, opts.policy);
  const outcome = tailor(row.resumeText, plan, editor);
  const score = {
    before: scoreOnText(row.resumeText, keywords, breakdown, matcher).score,
    after: scoreOnText(outcome.text, keywords, breakdown, matcher).score,
  };
  const checks: string[] = tailorChecks({ before: row.resumeText, plan, outcome, score }, editor);
  // A failed check is not argued with: the resume goes out as it stood.
  const text = checks.length === 0 ? outcome.text : row.resumeText;
  if (checks.length > 0) logger.warn({ jobId: posting.id, checks }, 'pack: the edits failed a check and were dropped');
  out.ms.tailor = Date.now() - started;

  let tailored: ResumeMatch | null = null;
  if (opts.rejudge && text !== row.resumeText) {
    tailored =
      (await storedComparison(posting.id, resume.id, text)) ??
      (await timed('rejudge', () => matchResumeToJob({ ...me, text }, posting, { mode: 'full', draft: true, onError })));
  }

  const document = await timed('document', async () => {
    const file = await getResumeOriginal(resume.id);
    const style = await resumeStyle(resume, { sourceFilename: file?.sourceFilename ?? '', original: file?.original ?? new Uint8Array() });
    const input: DraftInput = {
      sourceFilename: file?.sourceFilename ?? '',
      original: file ? Buffer.from(file.original) : null,
      baseText: row.resumeText,
      text,
      knobs: knobsFrom(style),
      layout: style.layout,
    };
    const doc = await draftDocx(input);
    return {
      kind: doc.kind,
      basis: doc.basis,
      docx: doc.docx,
      // The person's own .docx has no PDF of ours: they print the file they know.
      pdf: doc.kind === 'clean' ? await draftPdf(input) : null,
      fileName: documentFileName(resume.name, 'docx'),
    };
  });
  out.resume = { plan, outcome, text, score: checks.length === 0 ? score : { before: score.before, after: score.before }, checks, tailored, document };

  if (opts.coverLetter) {
    const letter = await timed('letter', () => generateCoverLetter({ ...me, text }, posting, { tone: 'warm', angles: opts.angles, evidence: 'own' })).catch(
      (err: unknown) => {
        logger.warn({ err, jobId: posting.id }, 'pack: the cover letter failed; the pack goes on without one');
        return null;
      },
    );
    if (letter?.kind === 'ok') out.letterId = letter.row.id;
  }
  return out;
}
