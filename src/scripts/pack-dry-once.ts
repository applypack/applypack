/*
 * The application pack, dry — what preparing an application with nobody
 * watching would do to the postings already stored, measured:
 *
 *   npm run pack:dry -- --out /tmp/pack-dry             # every kept posting with fit ≥ 90
 *   npm run pack:dry -- --min-fit 95 --limit 5 --no-verify
 *   npm run pack:dry -- --only 203,335 --rejudge
 *
 * Per posting, cheapest step first, each one able to stop it (pack/gate.ts):
 * is it still open (no AI) → the comparison with the search's resume → the
 * company check with web search → the edits the policy allows (pack/policy.ts)
 * applied as "Apply all" applies them → the file. `--out` gets the report,
 * and for every posting that reached the end its edits as Markdown and the
 * resume as .docx (and .pdf, for a clean version) — the thing to read before
 * deciding whether a file made this way is one to send.
 *
 * A stored comparison of the same text and a stored verification are reused,
 * and `records.json` in `--out` keeps what finished, so a second start pays
 * only for what is missing. `--rejudge` has the model judge each tailored
 * text again, to see how far the predicted score is from a judged one.
 *
 * Spends AI and writes rows (briefs, comparisons, verifications): run it on a
 * COPY of the database. Hand-run, never CI.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobStatus, type Prisma, type ResumeMatch } from '@prisma/client';
import { createLimiter } from '../concurrency';
import { prisma } from '../db';
import { dryReport, readDryRecords, type DryRecord, type DrySettings, type DryStep } from '../pack/dry-report';
import { compareStop, DEFAULT_MIN_CEILING, livenessStop, verifyStop, type Stop } from '../pack/gate';
import { DEFAULT_POLICY, planEdits, type EditPlan } from '../pack/policy';
import { loadEditor, scoreOnText, tailor, tailorChecks, type Editor, type EditOutcome } from '../pack/tailor';
import { getActiveProfile } from '../profiles';
import { briefForPosting } from '../resume/brief';
import { draftDocx, draftPdf, type DraftInput } from '../resume/draft-document';
import { loadKeywordMatcher, type KeywordMatcher } from '../resume/keyword-matcher';
import { matchResumeToJob } from '../resume/match';
import { readMatchEvidence, readMatchMode } from '../resume/match-mode';
import { readPromptVersion } from '../resume/match-reuse';
import { PROMPT_VERSION, readActions, readHardRequirements, readKeywords, readRemovals, type MatchKeyword } from '../resume/prompts';
import { knobsFrom } from '../resume/render/knobs';
import { readBreakdown } from '../resume/score';
import { getPostingRefreshedAt, listMatchesForText } from '../resume/store';
import { LIVENESS_CODE_LABEL, runLivenessLadder } from '../verification/liveness';
import { verifyJob } from '../verification/verify';
import { resumeStyle } from '../web/resume-style';
// The page's own "Copy my changes" sheet, so the edits read here as they do there.
// @ts-expect-error — plain JS with no declaration file.
import { formatEditSheet } from '../web/public/change-sheet.mjs';

const DEFAULT_MIN_FIT = 90;
const DEFAULT_CONCURRENCY = 2;
/** How many stored comparisons of one text are looked through for one to reuse. */
const STORED_CANDIDATES = 5;

const JOB_INCLUDE = {
  company: { select: { name: true, atsType: true, atsToken: true } },
  // The search that scored it best is the one whose resume it would be sent with.
  scores: { orderBy: { fitScore: 'desc' }, take: 1, select: { profile: { select: { resumeId: true } } } },
} satisfies Prisma.JobInclude;
type StoredJob = Prisma.JobGetPayload<{ include: typeof JOB_INCLUDE }>;

interface Tools {
  settings: DrySettings;
  verify: boolean;
  rejudge: boolean;
  out: string;
  editor: Editor;
  matcher: KeywordMatcher;
}

function flagValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function flagNumber(name: string, fallback: number): number {
  const v = Number(flagValue(name) ?? NaN);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** The resume the posting's best search hunts with, else the primary search's. */
async function resumeFor(job: StoredJob, fallbackId: number | null) {
  const id = job.scores[0]?.profile.resumeId ?? fallbackId;
  return id === null ? null : prisma.resume.findFirst({ where: { id, hidden: false } });
}

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

async function prepare(job: StoredJob, tools: Tools, fallbackResumeId: number | null): Promise<DryRecord> {
  const company = job.employer ?? job.company.name;
  const record: DryRecord = { jobId: job.id, title: job.title, company, fit: job.fitScore ?? 0, stop: null, why: null, ms: {} };
  const timed = async <T>(step: DryStep, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      record.ms[step] = Date.now() - started;
    }
  };
  const halt = (stop: Stop | null): boolean => {
    if (stop) Object.assign(record, stop);
    return stop !== null;
  };
  const fail = (why: string): DryRecord => Object.assign(record, { stop: 'error', why });
  let reason = '';
  const onError = (r: string): void => {
    reason = r;
  };

  const resume = await resumeFor(job, fallbackResumeId);
  if (!resume) return fail('No resume is linked to the search that scored this posting');

  const live = await timed('liveness', () =>
    runLivenessLadder({ url: job.url, externalId: job.externalId, atsType: job.company.atsType, atsToken: job.company.atsToken }),
  );
  if (halt(livenessStop({ liveness: live.liveness, label: LIVENESS_CODE_LABEL[live.code] }))) return record;

  const posting = { id: job.id, title: job.title, companyName: company, location: job.location, description: job.description };
  let row = await storedComparison(job.id, resume.id, resume.text);
  const reused = row !== null;
  if (!row) {
    const briefed = await timed('brief', () => briefForPosting(posting, { onError }));
    if (briefed?.reused) delete record.ms.brief;
    row = await timed('match', () =>
      matchResumeToJob({ id: resume.id, name: resume.name, text: resume.text, version: resume.version }, posting, { mode: 'full', brief: briefed, onError }),
    );
  }
  if (!row) return fail(`The comparison failed: ${reason || 'no reason given'}`);
  const breakdown = readBreakdown(row.breakdown);
  if (!breakdown) return fail('The stored comparison carries no score breakdown');
  const keywords = readKeywords(row.keywords);
  const actions = readActions(row.actions);
  record.match = {
    score: row.matchScore,
    ceiling: breakdown.ceiling ?? breakdown.score,
    reused,
    actions: actions.length,
    asks: keywords.filter((k) => k.status === 'ask_user').length,
    unbacked: keywords.filter((k) => k.status === 'cannot_claim').length,
  };
  if (halt(compareStop({ breakdown, hard: readHardRequirements(row.hardRequirements), minCeiling: tools.settings.minCeiling }))) return record;

  let verification = tools.verify ? await prisma.jobVerification.findFirst({ where: { jobId: job.id }, orderBy: { createdAt: 'desc' } }) : null;
  if (tools.verify) {
    const had = verification !== null;
    verification ??= await timed('verify', () => verifyJob({ ...posting, url: job.url, postedAt: job.postedAt }, onError));
    if (!verification) return fail(`The company check failed: ${reason || 'no reason given'}`);
    record.verify = { verdict: verification.verdict, recommendation: verification.recommendation, reused: had };
    if (halt(verifyStop(verification))) return record;
  }

  const started = Date.now();
  const plan = planEdits({ actions, removals: readRemovals(row.removals), keywords }, tools.settings.policy);
  const edited = tailor(row.resumeText, plan, tools.editor);
  const report = { keywords, redFlags: row.redFlags, alignment: breakdown.alignment };
  const score = { before: scoreOnText(row.resumeText, report, tools.matcher).score, after: scoreOnText(edited.text, report, tools.matcher).score };
  const checks: string[] = tailorChecks({ before: row.resumeText, plan, outcome: edited, score }, tools.editor);
  // The stored number was computed by the same formula on the same text; a
  // difference means the row predates a scoring change, and the lift is then
  // measured from the recomputed one.
  if (score.before !== row.matchScore) checks.push(`stored score was ${row.matchScore}`);
  record.ms.tailor = Date.now() - started;

  const base = path.join(tools.out, `${job.id}-${slug(company)}-${slug(job.title)}`);
  const file = await prisma.resume.findUniqueOrThrow({ where: { id: resume.id }, select: { sourceFilename: true, original: true } });
  const document = await timed('document', async () => {
    const style = await resumeStyle(resume, file);
    const input: DraftInput = {
      sourceFilename: file.sourceFilename,
      original: Buffer.from(file.original),
      baseText: row.resumeText,
      text: edited.text,
      knobs: knobsFrom(style),
      layout: style.layout,
    };
    const doc = await draftDocx(input);
    fs.writeFileSync(`${base}.docx`, doc.docx);
    // The person's own .docx has no PDF of ours: they print the file they know.
    if (doc.kind === 'clean') fs.writeFileSync(`${base}.pdf`, await draftPdf(input));
    return doc;
  });
  record.tailor = {
    applied: edited.done.length,
    unplaced: edited.failed.length,
    held: plan.held.length,
    ...score,
    checks,
    document: document.kind === 'own' ? 'own' : `clean (${document.basis})`,
  };

  if (tools.rejudge && edited.text !== row.resumeText) {
    const again =
      (await storedComparison(job.id, resume.id, edited.text)) ??
      (await timed('rejudge', () =>
        matchResumeToJob({ id: resume.id, name: resume.name, text: edited.text, version: resume.version }, posting, { mode: 'full', draft: true, onError }),
      ));
    if (again) record.tailor.rejudged = again.matchScore;
  }

  fs.writeFileSync(
    `${base}.md`,
    packSheet(record, { plan, edited, keywords, summary: verification?.summary ?? null, snapshot: verification?.companySnapshot ?? null }) +
      ((formatEditSheet({ jobTitle: job.title, companyName: company, resumeName: resume.name }, row.resumeText, edited.text) as string | null) ??
        'The policy left this resume as it was.\n'),
  );
  return record;
}

/** What a person reads before the edits themselves: the verdict, the numbers, and what was left to them. */
function packSheet(
  record: DryRecord,
  detail: { plan: EditPlan; edited: EditOutcome; keywords: MatchKeyword[]; summary: string | null; snapshot: string | null },
): string {
  const { plan, edited, keywords } = detail;
  const terms = (status: MatchKeyword['status']): string => keywords.filter((k) => k.status === status).map((k) => k.term).join(', ') || '—';
  const lines = [
    `# ${record.title} — ${record.company}`,
    '',
    `Fit ${record.fit} · match ${record.tailor?.before} → ${record.tailor?.after}` +
      (record.tailor?.rejudged === undefined ? '' : ` (judged again: ${record.tailor.rejudged})`) +
      ` · ceiling ${record.match?.ceiling}`,
    record.verify ? `Company: ${record.verify.verdict} · ${record.verify.recommendation}` : 'Company: not checked',
    ...(detail.summary ? ['', detail.summary] : []),
    ...(detail.snapshot ? ['', detail.snapshot] : []),
    '',
    `To ask you: ${terms('ask_user')}`,
    `Nothing backs: ${terms('cannot_claim')}`,
    '',
    `Applied ${edited.done.length}; could not place ${edited.failed.length}${edited.failed.length > 0 ? ` (${edited.failed.map((f) => `${f.kind}: ${f.error}`).join(', ')})` : ''}.`,
    ...(plan.held.length > 0 ? ['Left for you:', ...plan.held.map((h) => `- ${h.section} · ${h.where} — ${h.reason}`)] : []),
    ...(record.tailor && record.tailor.checks.length > 0 ? ['', `Checks: ${record.tailor.checks.join(', ')}`] : []),
    '',
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const out = path.resolve(flagValue('out') ?? path.join(os.tmpdir(), 'applypack-pack-dry'));
  fs.mkdirSync(out, { recursive: true });
  const settings: DrySettings = {
    minFit: flagNumber('min-fit', DEFAULT_MIN_FIT),
    minCeiling: flagNumber('min-ceiling', DEFAULT_MIN_CEILING),
    policy: DEFAULT_POLICY,
  };
  const only = (flagValue('only') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const limit = flagNumber('limit', 0);
  const jobs = await prisma.job.findMany({
    where: { fitScore: { gte: settings.minFit }, status: { not: JobStatus.DISMISSED }, ...(only.length > 0 ? { id: { in: only } } : {}) },
    orderBy: [{ fitScore: 'desc' }, { fetchedAt: 'desc' }],
    ...(limit > 0 ? { take: limit } : {}),
    include: JOB_INCLUDE,
  });

  const recordsFile = path.join(out, 'records.json');
  const kept = fs.existsSync(recordsFile) ? readDryRecords(JSON.parse(fs.readFileSync(recordsFile, 'utf8'))) : [];
  // A step that failed is not an answer: that posting runs again.
  const records = new Map(kept.filter((r) => r.stop !== 'error').map((r) => [r.jobId, r]));
  const todo = jobs.filter((j) => !records.has(j.id));
  console.log(`${jobs.length} postings with fit ≥ ${settings.minFit}; ${jobs.length - todo.length} already done, ${todo.length} to run → ${out}`);

  const tools: Tools = {
    settings,
    verify: !process.argv.includes('--no-verify'),
    rejudge: process.argv.includes('--rejudge'),
    out,
    editor: await loadEditor(),
    matcher: await loadKeywordMatcher(),
  };
  const fallbackResumeId = (await getActiveProfile())?.resumeId ?? null;
  const limiter = createLimiter(Math.max(1, flagNumber('concurrency', DEFAULT_CONCURRENCY)));
  await Promise.all(
    todo.map((job) =>
      limiter(async () => {
        const base = { jobId: job.id, title: job.title, company: job.employer ?? job.company.name, fit: job.fitScore ?? 0, ms: {} };
        const record = await prepare(job, tools, fallbackResumeId).catch(
          (err: unknown): DryRecord => ({ ...base, stop: 'error', why: err instanceof Error ? err.message : String(err) }),
        );
        records.set(job.id, record);
        fs.writeFileSync(recordsFile, JSON.stringify([...records.values()], null, 2));
        const seconds = Math.round(Object.values(record.ms).reduce((a, b) => a + (b ?? 0), 0) / 1000);
        console.log(`  ${job.id} · fit ${record.fit} · ${record.stop ?? 'ready'} · ${seconds}s${record.why ? ` · ${record.why.slice(0, 100)}` : ''}`);
      }),
    ),
  );

  // In the selection's order, and only the selection: an older run with other flags may have left more.
  const report = dryReport(jobs.flatMap((j) => records.get(j.id) ?? []), settings);
  fs.writeFileSync(path.join(out, 'report.md'), report);
  console.log(`\n${report}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
