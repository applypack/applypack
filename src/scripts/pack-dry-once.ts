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
import { JobStatus, type Prisma } from '@prisma/client';
import { createLimiter } from '../concurrency';
import { prisma } from '../db';
import { dryReport, readDryRecords, type DryRecord, type DrySettings } from '../pack/dry-report';
import { DEFAULT_MIN_CEILING } from '../pack/gate';
import { DEFAULT_POLICY } from '../pack/policy';
import { preparePosting, type Prepared, type PreparedResume } from '../pack/prepare';
import { getActiveProfile } from '../profiles';
import { readActions, readKeywords, type MatchKeyword } from '../resume/prompts';
import { readBreakdown } from '../resume/score';
// The page's own "Copy my changes" sheet, so the edits read here as they do there.
// @ts-expect-error — plain JS with no declaration file.
import { formatEditSheet } from '../web/public/change-sheet.mjs';

const DEFAULT_MIN_FIT = 90;
const DEFAULT_CONCURRENCY = 2;

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

async function prepare(job: StoredJob, tools: Tools, fallbackResumeId: number | null): Promise<DryRecord> {
  const company = job.employer ?? job.company.name;
  const record: DryRecord = { jobId: job.id, title: job.title, company, fit: job.fitScore ?? 0, stop: null, why: null, ms: {} };
  const resume = await resumeFor(job, fallbackResumeId);
  if (!resume) return { ...record, stop: 'error', why: 'No resume is linked to the search that scored this posting' };

  const prepared = await preparePosting(
    {
      id: job.id,
      title: job.title,
      companyName: company,
      location: job.location,
      description: job.description,
      url: job.url,
      externalId: job.externalId,
      postedAt: job.postedAt,
      atsType: job.company.atsType,
      atsToken: job.company.atsToken,
    },
    resume,
    { minCeiling: tools.settings.minCeiling, policy: tools.settings.policy, verify: tools.verify, rejudge: tools.rejudge, coverLetter: false },
  );
  record.ms = prepared.ms;
  if (prepared.error) Object.assign(record, { stop: 'error', why: prepared.error });
  else if (prepared.stop) Object.assign(record, prepared.stop);

  const { match, verification } = prepared;
  const breakdown = match ? readBreakdown(match.breakdown) : null;
  const keywords = match ? readKeywords(match.keywords) : [];
  if (match && breakdown) {
    record.match = {
      score: match.matchScore,
      ceiling: breakdown.ceiling ?? breakdown.score,
      reused: prepared.matchReused,
      actions: readActions(match.actions).length,
      asks: keywords.filter((k) => k.status === 'ask_user').length,
      unbacked: keywords.filter((k) => k.status === 'cannot_claim').length,
    };
  }
  if (verification) record.verify = { verdict: verification.verdict, recommendation: verification.recommendation, reused: prepared.verificationReused };

  const made = prepared.resume;
  if (!match || !made) return record;
  const checks = [...made.checks];
  // The stored number was computed by the same formula on the same text; a
  // difference means the row predates a scoring change, and the lift is then
  // measured from the recomputed one.
  if (made.score.before !== match.matchScore) checks.push(`stored score was ${match.matchScore}`);
  if (prepared.unchecked) checks.push('company not checked');
  record.tailor = {
    applied: made.outcome.done.length,
    unplaced: made.outcome.failed.length,
    held: made.plan.held.length,
    ...made.score,
    ...(made.tailored ? { rejudged: made.tailored.matchScore } : {}),
    checks,
    document: made.document.kind === 'own' ? 'own' : `clean (${made.document.basis})`,
  };

  const base = path.join(tools.out, `${job.id}-${slug(company)}-${slug(job.title)}`);
  fs.writeFileSync(`${base}.docx`, made.document.docx);
  if (made.document.pdf) fs.writeFileSync(`${base}.pdf`, made.document.pdf);
  fs.writeFileSync(
    `${base}.md`,
    packSheet(record, prepared, made, keywords) +
      ((formatEditSheet({ jobTitle: job.title, companyName: company, resumeName: resume.name }, match.resumeText, made.text) as string | null) ??
        'The policy left this resume as it was.\n'),
  );
  return record;
}

/** What a person reads before the edits themselves: the verdict, the numbers, and what was left to them. */
function packSheet(record: DryRecord, prepared: Prepared, made: PreparedResume, keywords: MatchKeyword[]): string {
  const { plan, outcome } = made;
  const { verification } = prepared;
  const terms = (status: MatchKeyword['status']): string => keywords.filter((k) => k.status === status).map((k) => k.term).join(', ') || '—';
  const lines = [
    `# ${record.title} — ${record.company}`,
    '',
    `Fit ${record.fit} · match ${made.score.before} → ${made.score.after}` +
      (made.tailored ? ` (judged again: ${made.tailored.matchScore})` : '') +
      ` · ceiling ${record.match?.ceiling}`,
    verification ? `Company: ${verification.verdict} · ${verification.recommendation}` : `Company: not checked${prepared.unchecked ? ` — ${prepared.unchecked}` : ''}`,
    ...(verification ? ['', verification.summary] : []),
    ...(verification?.companySnapshot ? ['', verification.companySnapshot] : []),
    '',
    `To ask you: ${terms('ask_user')}`,
    `Nothing backs: ${terms('cannot_claim')}`,
    '',
    `Applied ${outcome.done.length}; could not place ${outcome.failed.length}${outcome.failed.length > 0 ? ` (${outcome.failed.map((f) => `${f.kind}: ${f.error}`).join(', ')})` : ''}.`,
    ...(plan.held.length > 0 ? ['Left for you:', ...plan.held.map((h) => `- ${h.section} · ${h.where} — ${h.reason}`)] : []),
    ...(made.checks.length > 0 ? ['', `Checks failed, so the resume was left as it stood: ${made.checks.join(', ')}`] : []),
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

  const tools: Tools = { settings, verify: !process.argv.includes('--no-verify'), rejudge: process.argv.includes('--rejudge'), out };
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
